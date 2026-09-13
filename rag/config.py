"""
Configuração central do projeto.

Tudo que muda entre "rodar em casa" e "rodar no modo demonstração"
passa por aqui: pastas, tamanho dos chunks, provedores de embedding/LLM.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Carrega .env da raiz do repositório, se existir.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

# Pastas do pipeline. Documentos crus entram em data/raw;
# data/sample contém textos de exemplo versionados no git.
DATA_DIR = PROJECT_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
SAMPLE_DIR = DATA_DIR / "sample"
CHROMA_DIR = PROJECT_ROOT / "chroma_db"
COLLECTION_NAME = "rag_portfolio"


@dataclass(frozen=True)
class ChunkingConfig:
    """Parâmetros de fragmentação dos documentos.

    chunk_size: tamanho máximo de cada pedaço (em tokens aproximados).
    chunk_overlap: quantos tokens se repetem entre pedaços vizinhos.

    O overlap existe para não cortar uma ideia no meio: a frase final
    de um chunk reaparece no início do próximo, preservando contexto.
    """

    chunk_size: int = 512
    chunk_overlap: int = 64


@dataclass(frozen=True)
class RetrievalConfig:
    """Quantos trechos o retriever devolve para o LLM.

    top_k alto demais polui o prompt com texto irrelevante (e custa mais).
    top_k baixo demais pode omitir o trecho que realmente responde a pergunta.
    """

    top_k: int = 3


@dataclass(frozen=True)
class ProviderConfig:
    """Quais APIs estão disponíveis neste ambiente."""

    openai_api_key: str | None
    openai_embedding_model: str
    openai_llm_model: str
    voyage_api_key: str | None
    voyage_embedding_model: str
    xai_api_key: str | None
    xai_llm_model: str

    @property
    def embedding_provider(self) -> str:
        """voyage > openai > mock (hashing local)."""
        if self.voyage_api_key:
            return "voyage"
        if self.openai_api_key:
            return "openai"
        return "mock"

    @property
    def llm_provider(self) -> str:
        """xai/grok > openai > mock (resposta extractiva)."""
        if self.xai_api_key:
            return "xai"
        if self.openai_api_key:
            return "openai"
        return "mock"

    @property
    def is_demo_mode(self) -> bool:
        return self.embedding_provider == "mock" or self.llm_provider == "mock"


def load_providers() -> ProviderConfig:
    return ProviderConfig(
        openai_api_key=os.getenv("OPENAI_API_KEY") or None,
        openai_embedding_model=os.getenv(
            "OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"
        ),
        openai_llm_model=os.getenv("OPENAI_LLM_MODEL", "gpt-4o"),
        voyage_api_key=os.getenv("VOYAGE_API_KEY") or None,
        voyage_embedding_model=os.getenv("VOYAGE_EMBEDDING_MODEL", "voyage-3"),
        xai_api_key=os.getenv("XAI_API_KEY") or None,
        xai_llm_model=os.getenv("XAI_LLM_MODEL", "grok-3"),
    )
