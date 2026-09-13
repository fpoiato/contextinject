"""
Etapa 3 — Retrieval (recuperação / busca semântica).

Aqui AINDA NÃO geramos texto. Só perguntamos ao índice:

    "Quais chunks estão mais próximos desta pergunta no espaço vetorial?"

Como funciona a similaridade de cosseno:

- Cada chunk já foi transformado num vetor na indexação.
- A pergunta também vira um vetor, COM O MESMO modelo de embedding.
- Cosseno = 1 quando os vetores apontam para a mesma direção,
  0 quando são ortogonais, negativo quando apontam para lados opostos.
- O Chroma devolve os top_k vetores com maior cosseno.

Isso é busca SEMÂNTICA (significado), não busca por palavra-chave.
Com embeddings neurais, "cachorro" encontra trechos sobre "cão".
No modo demonstração (hashing), a busca é mais lexical.

Diferença retrieval vs geração:
- Retrieval escolhe evidências (trechos do seu acervo).
- Geração (próxima etapa) usa essas evidências para escrever a resposta.
  Sem retrieval, o LLM chutaria com o conhecimento de treinamento.
  Sem geração, você só tem uma lista de trechos — útil, mas não é uma resposta.
"""

from __future__ import annotations

from dataclasses import dataclass

from llama_index.core import VectorStoreIndex
from llama_index.core.schema import NodeWithScore

from rag.config import RetrievalConfig


@dataclass
class RetrievedChunk:
    """Versão amigável de um NodeWithScore, para CLI, testes e Streamlit."""

    text: str
    score: float | None
    source: str
    node_id: str

    @classmethod
    def from_node(cls, node: NodeWithScore) -> "RetrievedChunk":
        metadata = node.node.metadata or {}
        source = (
            metadata.get("file_name")
            or metadata.get("source")
            or metadata.get("file_path")
            or "desconhecido"
        )
        return cls(
            text=node.get_content().strip(),
            score=float(node.score) if node.score is not None else None,
            source=str(source),
            node_id=node.node.node_id,
        )


def retrieve(
    index: VectorStoreIndex,
    query: str,
    retrieval: RetrievalConfig | None = None,
) -> list[RetrievedChunk]:
    """Executa busca semântica pura — sem chamar o LLM.

    `as_retriever` devolve um objeto que só faz similaridade.
    Isso é proposital: dá para inspecionar os chunks ANTES de gastar
    tokens de geração, e dá para explicar o pipeline no portfólio.
    """
    retrieval = retrieval or RetrievalConfig()
    retriever = index.as_retriever(similarity_top_k=retrieval.top_k)
    nodes = retriever.retrieve(query)
    return [RetrievedChunk.from_node(node) for node in nodes]
