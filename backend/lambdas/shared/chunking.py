from __future__ import annotations

import re


def chunk_text(
    text: str,
    *,
    max_chars: int = 1400,
    overlap: int = 180,
    page: int | None = None,
) -> list[dict[str, object]]:
    cleaned = re.sub(r"\r\n?", "\n", text).strip()
    if not cleaned:
        return []

    paragraphs = re.split(r"\n{2,}", cleaned)
    chunks: list[dict[str, object]] = []
    buffer = ""

    def flush(force: bool = False) -> None:
        nonlocal buffer
        piece = buffer.strip()
        if not piece:
            buffer = ""
            return
        if len(piece) <= max_chars or force:
            chunks.append(
                {
                    "content": piece,
                    "page": page,
                    "token_count": max(1, len(piece) // 4),
                }
            )
            buffer = piece[-overlap:] if overlap and len(piece) > overlap else ""
            return
        start = 0
        while start < len(piece):
            end = min(start + max_chars, len(piece))
            if end < len(piece):
                split_at = piece.rfind(" ", start, end)
                if split_at > start + max_chars // 2:
                    end = split_at
            part = piece[start:end].strip()
            if part:
                chunks.append(
                    {
                        "content": part,
                        "page": page,
                        "token_count": max(1, len(part) // 4),
                    }
                )
            if end >= len(piece):
                break
            start = max(0, end - overlap)
        buffer = ""

    for paragraph in paragraphs:
        candidate = paragraph.strip()
        if not candidate:
            continue
        if buffer and len(buffer) + 2 + len(candidate) > max_chars:
            flush()
        buffer = f"{buffer}\n\n{candidate}".strip() if buffer else candidate
        if len(buffer) >= max_chars:
            flush()
    flush(force=True)
    for index, chunk in enumerate(chunks):
        chunk["chunk_index"] = index
    return chunks
