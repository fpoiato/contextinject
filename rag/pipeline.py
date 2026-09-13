"""
Orquestra as quatro etapas do RAG:

    ingestão → indexação (chunk + embed) → retrieval → geração

Os scripts CLI e o Streamlit só falam com esta fachada. Assim o
pipeline permanece o mesmo, qualquer que seja a interface.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from rag.config import ChunkingConfig, RetrievalConfig, load_providers
from rag.generate import GenerationResult, generate
from rag.index import build_index, collection_count, load_index
from rag.ingest import load_documents, resolve_input_dir
from rag.retrieve import RetrievedChunk, retrieve


@dataclass
class RagAnswer:
    query: str
    chunks: list[RetrievedChunk]
    generation: GenerationResult

    @property
    def answer(self) -> str:
        return self.generation.answer


class RagPipeline:
    def __init__(
        self,
        chunking: ChunkingConfig | None = None,
        retrieval: RetrievalConfig | None = None,
    ) -> None:
        self.chunking = chunking or ChunkingConfig()
        self.retrieval = retrieval or RetrievalConfig()

    @property
    def indexed_chunks(self) -> int:
        return collection_count()

    def ingest(self, input_dir: Path | None = None, reset: bool = True) -> dict:
        """Etapas 1 e 2: lê documentos e (re)constrói o índice no Chroma."""
        directory = resolve_input_dir(input_dir)
        documents = load_documents(directory)
        _index, nodes, embed_provider = build_index(
            documents,
            chunking=self.chunking,
            reset=reset,
        )
        sources = sorted(
            {
                (doc.metadata.get("file_name") or doc.metadata.get("source") or "?")
                for doc in documents
            }
        )
        return {
            "input_dir": str(directory),
            "documents": len(documents),
            "chunks": len(nodes),
            "sources": sources,
            "embed_provider": embed_provider,
            "llm_provider": load_providers().llm_provider,
        }

    def search(self, query: str) -> list[RetrievedChunk]:
        """Etapa 3 isolada: só busca semântica, sem gerar resposta."""
        if self.indexed_chunks == 0:
            raise RuntimeError(
                "O índice está vazio. Rode a ingestão antes da busca."
            )
        index, _provider = load_index()
        return retrieve(index, query, retrieval=self.retrieval)

    def ask(self, query: str) -> RagAnswer:
        """Etapas 3 e 4: recupera evidências e gera a resposta."""
        chunks = self.search(query)
        generation = generate(query, chunks)
        return RagAnswer(query=query, chunks=chunks, generation=generation)

    def status(self) -> dict:
        providers = load_providers()
        return {
            "indexed_chunks": self.indexed_chunks,
            "embed_provider": providers.embedding_provider,
            "llm_provider": providers.llm_provider,
            "demo_mode": providers.is_demo_mode,
            "chunk_size": self.chunking.chunk_size,
            "chunk_overlap": self.chunking.chunk_overlap,
            "top_k": self.retrieval.top_k,
        }
