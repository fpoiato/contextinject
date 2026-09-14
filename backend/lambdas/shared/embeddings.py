from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import numpy as np
import boto3
from huggingface_hub import hf_hub_download
from tokenizers import Tokenizer

MODEL_ID = os.environ.get("EMBEDDING_MODEL_ID", "Xenova/multilingual-e5-base")
MODEL_S3_KEY = os.environ.get("EMBEDDING_S3_KEY", "models/multilingual-e5-base/model_quantized.onnx")
LOCAL_MODEL_DIR = Path(os.environ.get("EMBEDDING_CACHE_DIR", "/tmp/e5"))
EMBEDDING_DIM = 768


def _prefix(text: str, *, is_query: bool) -> str:
    cleaned = text.strip().replace("\n", " ")
    kind = "query" if is_query else "passage"
    if cleaned.lower().startswith(("query:", "passage:")):
        return cleaned
    return f"{kind}: {cleaned}"


@lru_cache(maxsize=1)
def _tokenizer() -> Tokenizer:
    bundled = Path(__file__).with_name("tokenizer.json")
    if bundled.exists():
        return Tokenizer.from_file(str(bundled))
    LOCAL_MODEL_DIR.mkdir(parents=True, exist_ok=True)
    path = hf_hub_download(
        repo_id=MODEL_ID,
        filename="tokenizer.json",
        local_dir=str(LOCAL_MODEL_DIR),
    )
    return Tokenizer.from_file(path)


def _download_from_s3(dest: Path) -> bool:
    bucket = os.environ.get("MODELS_BUCKET") or os.environ.get("DOCUMENTS_BUCKET")
    if not bucket:
        return False
    client = boto3.client("s3")
    try:
        client.download_file(bucket, MODEL_S3_KEY, str(dest))
        return dest.exists() and dest.stat().st_size > 0
    except client.exceptions.NoSuchKey:
        return False
    except Exception:
        return False


@lru_cache(maxsize=1)
def _session():
    import onnxruntime as ort

    LOCAL_MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model_path = LOCAL_MODEL_DIR / "model_quantized.onnx"
    if not model_path.exists():
        if not _download_from_s3(model_path):
            downloaded = hf_hub_download(
                repo_id=MODEL_ID,
                filename="onnx/model_quantized.onnx",
                local_dir=str(LOCAL_MODEL_DIR),
            )
            src = Path(downloaded)
            if src != model_path:
                model_path.write_bytes(src.read_bytes())
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 2
    opts.inter_op_num_threads = 1
    return ort.InferenceSession(str(model_path), sess_options=opts, providers=["CPUExecutionProvider"])


def embed_texts(texts: list[str], *, is_query: bool = False) -> list[list[float]]:
    if not texts:
        return []
    tokenizer = _tokenizer()
    session = _session()
    vectors: list[list[float]] = []
    batch_size = 8
    for start in range(0, len(texts), batch_size):
        batch = [_prefix(text, is_query=is_query) for text in texts[start : start + batch_size]]
        encoded = tokenizer.encode_batch(batch)
        max_len = min(max(len(item.ids) for item in encoded), 512)
        input_ids = np.zeros((len(encoded), max_len), dtype=np.int64)
        attention_mask = np.zeros((len(encoded), max_len), dtype=np.int64)
        for row, item in enumerate(encoded):
            ids = item.ids[:max_len]
            input_ids[row, : len(ids)] = ids
            attention_mask[row, : len(ids)] = 1
        feeds = {}
        input_names = [i.name for i in session.get_inputs()]
        feeds[input_names[0]] = input_ids
        if len(input_names) > 1:
            feeds[input_names[1]] = attention_mask
        if len(input_names) > 2:
            feeds[input_names[2]] = np.zeros_like(input_ids)
        outputs = session.run(None, feeds)[0]
        hidden = np.array(outputs)
        if hidden.ndim == 3:
            mask = attention_mask[:, :, None]
            summed = (hidden * mask).sum(axis=1)
            counts = np.clip(mask.sum(axis=1), 1, None)
            pooled = summed / counts
        else:
            pooled = hidden
        norms = np.linalg.norm(pooled, axis=1, keepdims=True)
        pooled = pooled / np.clip(norms, 1e-12, None)
        vectors.extend(pooled.astype(np.float32).tolist())
    return vectors
