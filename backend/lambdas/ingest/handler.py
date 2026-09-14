from __future__ import annotations

import json
import os
import uuid
from typing import Any

import boto3
from botocore.exceptions import ClientError

from chunking import chunk_text
from db import DatabaseUnavailableError, connect, ensure_schema
from parse import ParseError, extract_document


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    records = event.get("Records") or []
    if records:
        results = [_handle_s3_record(record) for record in records]
        return {"ok": True, "results": results}

    body = event.get("body")
    payload = json.loads(body) if isinstance(body, str) else (body or event)
    s3_key = payload.get("s3_key") or payload.get("key")
    if not s3_key:
        return _response(400, {"error": "s3_key is required"})
    result = _ingest_key(
        s3_key=s3_key,
        filename=payload.get("filename"),
        content_type=payload.get("content_type"),
        user_id=payload.get("user_id") or "local",
        document_id=payload.get("document_id"),
    )
    return _response(200, result)


def _response(status: int, body: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def _handle_s3_record(record: dict[str, Any]) -> dict[str, Any]:
    bucket = record["s3"]["bucket"]["name"]
    key = record["s3"]["object"]["key"].replace("+", " ")
    os.environ["DOCUMENTS_BUCKET"] = bucket
    return _ingest_key(s3_key=key, filename=key.split("/")[-1], content_type=None, user_id="local")


def _ingest_key(
    *,
    s3_key: str,
    filename: str | None,
    content_type: str | None,
    user_id: str,
    document_id: str | None = None,
) -> dict[str, Any]:
    bucket = os.environ["DOCUMENTS_BUCKET"]
    s3 = boto3.client("s3")
    obj = s3.get_object(Bucket=bucket, Key=s3_key)
    body = obj["Body"].read()
    obj["Body"].close()
    filename = filename or s3_key.split("/")[-1]
    content_type = content_type or obj.get("ContentType")

    conn = connect()
    ensure_schema(conn)
    doc_id = document_id or str(uuid.uuid4())
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO documents (id, user_id, filename, content_type, s3_key, status, bytes)
                VALUES (%s, %s, %s, %s, %s, 'processing', %s)
                ON CONFLICT (s3_key) DO UPDATE
                  SET status = 'processing', error = NULL, updated_at = now()
                RETURNING id
                """,
                (doc_id, user_id, filename, content_type, s3_key, len(body)),
            )
            row = cur.fetchone()
            doc_id = str(row["id"])
        conn.commit()

        pages = extract_document(filename, body, content_type)
        chunks: list[dict[str, Any]] = []
        for page in pages:
            chunks.extend(chunk_text(page["text"], page=page.get("page")))
        if not chunks:
            raise ParseError("No text chunks produced")

        with conn.cursor() as cur:
            cur.execute("DELETE FROM chunks WHERE document_id = %s", (doc_id,))
            for chunk in chunks:
                cur.execute(
                    """
                    INSERT INTO chunks (document_id, user_id, chunk_index, content, page, token_count, metadata)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                    RETURNING id
                    """,
                    (
                        doc_id,
                        user_id,
                        chunk["chunk_index"],
                        chunk["content"],
                        chunk.get("page"),
                        chunk.get("token_count"),
                        json.dumps({"filename": filename, "s3_key": s3_key}),
                    ),
                )
                chunk["id"] = str(cur.fetchone()["id"])
        conn.commit()
    except (ParseError, DatabaseUnavailableError) as exc:
        _mark_error(conn, doc_id, str(exc))
        raise
    finally:
        conn.close()

    lambda_client = boto3.client("lambda")
    try:
        lambda_client.invoke(
            FunctionName=os.environ["EMBED_FUNCTION_NAME"],
            InvocationType="Event",
            Payload=json.dumps(
                {
                    "document_id": doc_id,
                    "user_id": user_id,
                }
            ).encode("utf-8"),
        )
    except ClientError as exc:
        conn = connect()
        _mark_error(conn, doc_id, f"Failed to start embedding: {exc}")
        conn.close()
        raise

    return {"document_id": doc_id, "chunks": len(chunks), "status": "embedding"}


def _mark_error(conn: Any, document_id: str, message: str) -> None:
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE documents
                SET status = 'error', error = %s, updated_at = now()
                WHERE id = %s
                """,
                (message[:2000], document_id),
            )
        conn.commit()
    except Exception:
        pass
