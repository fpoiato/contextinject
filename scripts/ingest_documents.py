#!/usr/bin/env python3
"""Ingere PDFs/TXT e cria o índice vetorial no ChromaDB local.

Uso (na raiz do repositório):

    python scripts/ingest_documents.py
    python scripts/ingest_documents.py --input data/raw
    python scripts/ingest_documents.py --chunk-size 256 --chunk-overlap 32
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from rag.config import ChunkingConfig  # noqa: E402
from rag.pipeline import RagPipeline  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ingestão + indexação (chunking, embeddings, ChromaDB)."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=None,
        help="Pasta com PDFs/TXT. Padrão: data/raw se houver arquivos, senão data/sample.",
    )
    parser.add_argument("--chunk-size", type=int, default=512)
    parser.add_argument("--chunk-overlap", type=int, default=64)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    pipeline = RagPipeline(
        chunking=ChunkingConfig(
            chunk_size=args.chunk_size,
            chunk_overlap=args.chunk_overlap,
        )
    )
    summary = pipeline.ingest(input_dir=args.input, reset=True)

    print("Ingestão concluída.")
    print(f"  pasta      : {summary['input_dir']}")
    print(f"  documentos : {summary['documents']}")
    print(f"  chunks     : {summary['chunks']}")
    print(f"  embedding  : {summary['embed_provider']}")
    print(f"  fontes     : {', '.join(summary['sources'])}")
    print()
    print("Próximo passo: python scripts/query_rag.py \"o que é RAG?\"")


if __name__ == "__main__":
    main()
