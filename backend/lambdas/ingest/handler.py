from __future__ import annotations

import json
import os
from typing import Any

import boto3
from botocore.exceptions import ClientError

from chunking import chunk_text
from db import DatabaseUnavailableError, connect, ensure_schema
from parse import ParseError, extract_document

GB = 1024**3
PLAN_LIMITS = {"starter": 1 * GB, "pro": 50 * GB, "business": 200 * GB}


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    body = event.get("body")
    payload = json.loads(body) if isinstance(body, str) else (body or event)
    document_id = payload.get("document_id")
    if not document_id:
        return _response(400, {"error": "document_id is required"})
    result = _ingest_document(str(document_id))
    return _response(200, result)


def _response(status: int, body: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def _ingest_document(doc_id: str) -> dict[str, Any]:
    bucket = os.environ["DOCUMENTS_BUCKET"]
    s3 = boto3.client("s3")

    conn = connect()
    ensure_schema(conn)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT d.id, d.user_id, d.project_id, d.filename, d.content_type, d.s3_key, u.plan
                FROM documents d
                JOIN users u ON u.id = d.user_id
                WHERE d.id = %s
                """,
                (doc_id,),
            )
            doc = cur.fetchone()
        if not doc:
            return {"document_id": doc_id, "status": "missing"}

        user_id = doc["user_id"]
        project_id = doc["project_id"]
        filename = doc["filename"]
        s3_key = doc["s3_key"]

        try:
            obj = s3.get_object(Bucket=bucket, Key=s3_key)
        except ClientError as exc:
            _mark_error(conn, doc_id, f"Uploaded file not found: {exc}")
            return {"document_id": doc_id, "status": "error"}
        body = obj["Body"].read()
        obj["Body"].close()
        content_type = doc["content_type"] or obj.get("ContentType")
        size = len(body)

        with conn.cursor() as cur:
            cur.execute(
                "SELECT COALESCE(SUM(bytes), 0) AS used FROM documents WHERE user_id = %s AND id <> %s",
                (user_id, doc_id),
            )
            used = int(cur.fetchone()["used"])
        limit = PLAN_LIMITS.get(doc.get("plan") or "starter", PLAN_LIMITS["starter"])
        if used + size > limit:
            s3.delete_object(Bucket=bucket, Key=s3_key)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE documents
                    SET status = 'error', bytes = NULL,
                        error = 'Storage limit reached for your plan. Delete documents or upgrade.',
                        updated_at = now()
                    WHERE id = %s
                    """,
                    (doc_id,),
                )
            conn.commit()
            return {"document_id": doc_id, "status": "quota_exceeded"}

        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE documents
                SET status = 'processing', error = NULL, bytes = %s, content_type = %s, updated_at = now()
                WHERE id = %s
                """,
                (size, content_type, doc_id),
            )
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
                    INSERT INTO chunks
                      (document_id, user_id, project_id, chunk_index, content, page, token_count, metadata)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    """,
                    (
                        doc_id,
                        user_id,
                        project_id,
                        chunk["chunk_index"],
                        chunk["content"],
                        chunk.get("page"),
                        chunk.get("token_count"),
                        json.dumps({"filename": filename, "s3_key": s3_key}),
                    ),
                )
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
            Payload=json.dumps({"document_id": doc_id, "user_id": user_id}).encode("utf-8"),
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
