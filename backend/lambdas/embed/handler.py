from __future__ import annotations

import json
from typing import Any

from db import connect, ensure_schema
from embeddings import EMBEDDING_DIM, embed_texts


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    payload = event.get("body")
    if isinstance(payload, str):
        event = json.loads(payload)

    if event.get("texts"):
        vectors = embed_texts(list(event["texts"]), is_query=bool(event.get("is_query")))
        return {"ok": True, "embeddings": vectors, "dim": EMBEDDING_DIM}

    document_id = event.get("document_id")
    if not document_id:
        return {"ok": False, "error": "document_id or texts is required"}

    conn = connect()
    try:
        ensure_schema(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, content
                FROM chunks
                WHERE document_id = %s AND embedding IS NULL
                ORDER BY chunk_index
                """,
                (document_id,),
            )
            rows = cur.fetchall()
        if not rows:
            _set_document_status(conn, document_id, "ready")
            return {"ok": True, "embedded": 0}

        texts = [row["content"] for row in rows]
        vectors = embed_texts(texts, is_query=False)
        with conn.cursor() as cur:
            for row, vector in zip(rows, vectors, strict=True):
                cur.execute(
                    "UPDATE chunks SET embedding = %s::vector WHERE id = %s",
                    (_to_pgvector(vector), row["id"]),
                )
        _set_document_status(conn, document_id, "ready")
        conn.commit()
        return {"ok": True, "embedded": len(vectors)}
    except Exception as exc:
        _set_document_status(conn, document_id, "error", str(exc))
        raise
    finally:
        conn.close()


def _set_document_status(conn: Any, document_id: str, status: str, error: str | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE documents
            SET status = %s, error = %s, updated_at = now()
            WHERE id = %s
            """,
            (status, error, document_id),
        )
    conn.commit()


def _to_pgvector(vector: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in vector) + "]"
