from __future__ import annotations

import io
import os
import time
from typing import Any

import httpx

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover
    PdfReader = None  # type: ignore[misc, assignment]


class ParseError(RuntimeError):
    pass


def extract_document(filename: str, body: bytes, content_type: str | None) -> list[dict[str, Any]]:
    lower = filename.lower()
    if lower.endswith((".txt", ".md", ".csv", ".json")) or (content_type or "").startswith("text/"):
        text = body.decode("utf-8", errors="replace")
        return [{"page": 1, "text": text}]

    llama_key = os.environ.get("LLAMA_CLOUD_API_KEY", "").strip()
    if llama_key and lower.endswith((".pdf", ".docx", ".pptx", ".doc", ".ppt")):
        parsed = _llamaparse(filename, body, llama_key)
        if parsed:
            return parsed

    if lower.endswith(".pdf"):
        return _pypdf(body)

    text = body.decode("utf-8", errors="replace")
    return [{"page": 1, "text": text}]


def _pypdf(body: bytes) -> list[dict[str, Any]]:
    if PdfReader is None:
        raise ParseError("pypdf is not available to parse PDF files")
    reader = PdfReader(io.BytesIO(body))
    pages: list[dict[str, Any]] = []
    for index, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        if text:
            pages.append({"page": index, "text": text})
    if not pages:
        raise ParseError("No extractable text found in PDF")
    return pages


def _llamaparse(filename: str, body: bytes, api_key: str) -> list[dict[str, Any]]:
    headers = {"Authorization": f"Bearer {api_key}"}
    with httpx.Client(timeout=60.0) as client:
        upload = client.post(
            "https://api.cloud.llamaindex.ai/api/v1/parsing/upload",
            headers=headers,
            files={"file": (filename, body)},
        )
        upload.raise_for_status()
        job = upload.json()
        job_id = job.get("id") or job.get("job_id")
        if not job_id:
            raise ParseError("LlamaParse did not return a job id")

        result: dict[str, Any] | None = None
        for _ in range(60):
            status_res = client.get(
                f"https://api.cloud.llamaindex.ai/api/v1/parsing/job/{job_id}",
                headers=headers,
            )
            status_res.raise_for_status()
            payload = status_res.json()
            status = str(payload.get("status", "")).upper()
            if status in {"SUCCESS", "COMPLETED"}:
                result = payload
                break
            if status in {"ERROR", "FAILED"}:
                raise ParseError(payload.get("error", "LlamaParse failed"))
            time.sleep(2)
        if result is None:
            raise ParseError("LlamaParse timed out")

        markdown_res = client.get(
            f"https://api.cloud.llamaindex.ai/api/v1/parsing/job/{job_id}/result/markdown",
            headers=headers,
        )
        markdown_res.raise_for_status()
        markdown = markdown_res.json().get("markdown") or markdown_res.text
    pages = []
    for index, part in enumerate(str(markdown).split("\n---\n"), start=1):
        text = part.strip()
        if text:
            pages.append({"page": index, "text": text})
    return pages or [{"page": 1, "text": str(markdown)}]
