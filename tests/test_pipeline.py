"""Testes do pipeline educacional — não precisam de chave de API."""

from __future__ import annotations

import math

from llama_index.core import Document

from rag.config import ChunkingConfig, RetrievalConfig, SAMPLE_DIR, load_providers
from rag.embeddings import HashingEmbedding
from rag.generate import generate
from rag.ingest import load_documents, resolve_input_dir
from rag.index import split_into_nodes
from rag.pipeline import RagPipeline
from rag.retrieve import RetrievedChunk


def test_sample_dir_is_the_default_when_raw_is_empty() -> None:
    directory = resolve_input_dir()
    assert directory == SAMPLE_DIR


def test_load_documents_reads_the_three_sample_files() -> None:
    documents = load_documents(SAMPLE_DIR)
    names = {doc.metadata.get("file_name") for doc in documents}
    assert len(documents) >= 3
    assert any("rag" in (name or "").lower() for name in names)


def test_chunking_splits_long_text_and_keeps_source_metadata() -> None:
    long_text = ("RAG usa retrieval e geracao. " * 80).strip()
    documents = [Document(text=long_text, metadata={"file_name": "demo.txt"})]
    nodes = split_into_nodes(
        documents,
        chunking=ChunkingConfig(chunk_size=64, chunk_overlap=16),
    )
    assert len(nodes) > 1
    assert all(node.metadata.get("file_name") == "demo.txt" for node in nodes)


def test_hashing_embedding_is_normalized_and_stable() -> None:
    model = HashingEmbedding()
    vector = model._get_text_embedding("chunking overlap embeddings")
    assert len(vector) == 384
    norm = math.sqrt(sum(value * value for value in vector))
    assert abs(norm - 1.0) < 1e-6
    again = model._get_text_embedding("chunking overlap embeddings")
    assert vector == again


def test_similar_texts_have_higher_cosine_than_unrelated_texts() -> None:
    model = HashingEmbedding()
    query = model._get_query_embedding("por que chunking e importante")
    close = model._get_text_embedding(
        "chunking corta documentos em pedacos para embeddings melhores"
    )
    far = model._get_text_embedding("receita de bolo de chocolate com morango")

    def cosine(a: list[float], b: list[float]) -> float:
        return sum(x * y for x, y in zip(a, b))

    assert cosine(query, close) > cosine(query, far)


def test_full_pipeline_retrieval_and_generation_in_demo_mode(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("VOYAGE_API_KEY", raising=False)
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    monkeypatch.delenv("CURSOR_API_KEY", raising=False)
    pipeline = RagPipeline(
        chunking=ChunkingConfig(chunk_size=256, chunk_overlap=32),
        retrieval=RetrievalConfig(top_k=3),
    )
    summary = pipeline.ingest(input_dir=SAMPLE_DIR, reset=True)
    assert summary["chunks"] > 0
    assert summary["embed_provider"] == "mock"

    chunks = pipeline.search("o que e retrieval augmented generation")
    assert chunks
    assert all(chunk.text.strip() for chunk in chunks)

    answer = pipeline.ask("qual a diferenca entre retrieval e geracao")
    assert answer.chunks
    assert "demonstração" in answer.answer.lower() or "retrieval" in answer.answer.lower()
    assert "Pergunta:" in answer.generation.prompt


def test_placeholder_keys_are_ignored(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-seu-token-aqui")
    monkeypatch.setenv("CURSOR_API_KEY", "cursor-seu-token-aqui")
    monkeypatch.setenv("XAI_API_KEY", "")
    monkeypatch.setenv("VOYAGE_API_KEY", "")
    providers = load_providers()
    assert providers.llm_provider == "mock"
    assert providers.embedding_provider == "mock"


def test_cursor_key_selects_cursor_llm(monkeypatch) -> None:
    monkeypatch.setenv("CURSOR_API_KEY", "cursor_test_key")
    monkeypatch.delenv("CURSOR_LLM_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    monkeypatch.delenv("VOYAGE_API_KEY", raising=False)
    providers = load_providers()
    assert providers.llm_provider == "cursor"
    assert providers.cursor_llm_model == "composer-2.5"
    assert providers.embedding_provider == "mock"
    assert providers.is_demo_mode is False


def test_generate_uses_cursor_agent_when_key_is_set(monkeypatch) -> None:
    monkeypatch.setenv("CURSOR_API_KEY", "cursor_test_key")
    monkeypatch.delenv("CURSOR_LLM_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("XAI_API_KEY", raising=False)

    def fake_cursor_agent(message: str, api_key: str, model: str) -> str:
        assert "Contexto recuperado" in message
        assert api_key == "cursor_test_key"
        assert model == "composer-2.5"
        return "Resposta gerada pelo Cursor."

    monkeypatch.setattr("rag.generate._call_cursor_agent", fake_cursor_agent)
    result = generate(
        "o que e rag?",
        [
            RetrievedChunk(
                text="RAG combina retrieval e geracao.",
                source="demo.txt",
                score=0.9,
                node_id="demo-1",
            )
        ],
    )
    assert result.provider == "cursor"
    assert result.model == "composer-2.5"
    assert result.answer == "Resposta gerada pelo Cursor."
