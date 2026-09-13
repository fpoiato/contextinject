#!/usr/bin/env python3
"""Busca semântica (e, opcionalmente, geração) sobre o índice local.

Uso:

    python scripts/query_rag.py "o que é chunking?"
    python scripts/query_rag.py "o que é chunking?" --retrieve-only
    python scripts/query_rag.py "o que é chunking?" --top-k 5
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from rag.config import RetrievalConfig  # noqa: E402
from rag.pipeline import RagPipeline  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Retrieval semântico e geração de resposta (RAG)."
    )
    parser.add_argument("query", help="Pergunta em linguagem natural")
    parser.add_argument(
        "--retrieve-only",
        action="store_true",
        help="Mostra só os chunks (sem chamar o LLM). Ideal para estudar similaridade.",
    )
    parser.add_argument("--top-k", type=int, default=3)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    pipeline = RagPipeline(retrieval=RetrievalConfig(top_k=args.top_k))

    print(f"Pergunta: {args.query}")
    print(f"Chunks no índice: {pipeline.indexed_chunks}")
    print()

    if args.retrieve_only:
        chunks = pipeline.search(args.query)
        print("=== RETRIEVAL (busca semântica, sem geração) ===")
        for i, chunk in enumerate(chunks, start=1):
            score = f"{chunk.score:.3f}" if chunk.score is not None else "?"
            print(f"\n--- trecho {i} | score={score} | fonte={chunk.source} ---")
            print(chunk.text)
        return

    result = pipeline.ask(args.query)
    print("=== CHUNKS RECUPERADOS ===")
    for i, chunk in enumerate(result.chunks, start=1):
        score = f"{chunk.score:.3f}" if chunk.score is not None else "?"
        preview = chunk.text.replace("\n", " ")[:180]
        print(f"  {i}. [{score}] {chunk.source}: {preview}...")

    print()
    print(f"=== RESPOSTA ({result.generation.provider}/{result.generation.model}) ===")
    print(result.answer)


if __name__ == "__main__":
    main()
