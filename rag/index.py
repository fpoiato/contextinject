"""
Etapa 2 — Chunking + embeddings + indexação no ChromaDB.

É aqui que o texto vira algo pesquisável:

1. Documentos longos são cortados em chunks (pedaços).
2. Cada chunk é convertido em um vetor (embedding).
3. Os vetores são gravados no ChromaDB local, em disco.

Por que chunking importa?
- Um PDF de 40 páginas num único vetor "média" todos os assuntos e a
  busca não consegue achar o parágrafo certo.
- Chunks pequenos demais perdem contexto (uma frase isolada não explica nada).
- Overlap (sobreposição) evita cortar uma ideia exatamente na fronteira.

Analogia: em vez de indexar um livro inteiro como um único cartão,
indexamos cada seção. Na hora da pergunta, puxamos só as seções certas.
"""

from __future__ import annotations

from llama_index.core import StorageContext, VectorStoreIndex
from llama_index.core.embeddings import BaseEmbedding
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.schema import BaseNode, Document
from llama_index.vector_stores.chroma import ChromaVectorStore

import chromadb

from rag.config import CHROMA_DIR, COLLECTION_NAME, ChunkingConfig, load_providers
from rag.embeddings import HashingEmbedding


def build_embed_model() -> tuple[BaseEmbedding, str]:
    """Escolhe o modelo de embedding conforme as chaves disponíveis.

    Retorna (modelo, nome_do_provedor) para a UI mostrar o modo atual.
    """
    providers = load_providers()

    if providers.embedding_provider == "voyage":
        from llama_index.embeddings.voyageai import VoyageEmbedding

        return (
            VoyageEmbedding(
                model_name=providers.voyage_embedding_model,
                voyage_api_key=providers.voyage_api_key,
            ),
            "voyage",
        )

    if providers.embedding_provider == "openai":
        from llama_index.embeddings.openai import OpenAIEmbedding

        return (
            OpenAIEmbedding(
                model=providers.openai_embedding_model,
                api_key=providers.openai_api_key,
            ),
            "openai",
        )

    return HashingEmbedding(), "mock"


def get_chroma_collection(reset: bool = False):
    """Abre (ou recria) a collection persistente do ChromaDB.

    PersistentClient grava os vetores em chroma_db/ — se você fechar o
    programa, o índice continua lá. Não é um servidor: é um banco embarcado.
    """
    CHROMA_DIR.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    if reset:
        try:
            client.delete_collection(COLLECTION_NAME)
        except Exception:
            pass
    return client.get_or_create_collection(COLLECTION_NAME)


def split_into_nodes(
    documents: list[Document],
    chunking: ChunkingConfig | None = None,
) -> list[BaseNode]:
    """Corta documentos em nós (chunks) prontos para embeddar.

    SentenceSplitter tenta respeitar fronteiras de frase, em vez de
    cortar no meio de uma palavra. Cada Node herda os metadados do
    documento original (nome do arquivo), o que depois vira citação.
    """
    chunking = chunking or ChunkingConfig()
    splitter = SentenceSplitter(
        chunk_size=chunking.chunk_size,
        chunk_overlap=chunking.chunk_overlap,
    )
    return splitter.get_nodes_from_documents(documents)


def build_index(
    documents: list[Document],
    chunking: ChunkingConfig | None = None,
    reset: bool = True,
) -> tuple[VectorStoreIndex, list[BaseNode], str]:
    """Pipeline completo de indexação.

    reset=True apaga a collection anterior. Para um portfólio local isso
    é o comportamento mais previsível: cada ingestão recria o índice.
    """
    embed_model, provider = build_embed_model()
    nodes = split_into_nodes(documents, chunking=chunking)

    collection = get_chroma_collection(reset=reset)
    vector_store = ChromaVectorStore(chroma_collection=collection)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)

    index = VectorStoreIndex(
        nodes,
        storage_context=storage_context,
        embed_model=embed_model,
        show_progress=True,
    )
    return index, nodes, provider


def load_index() -> tuple[VectorStoreIndex, str]:
    """Reabre o índice já gravado no Chroma, sem reler os PDFs.

    Os embeddings NÃO são recalculados: o Chroma devolve os vetores
    salvos. Só precisamos do mesmo modelo de embedding para embeddar
    a *pergunta* na hora da busca (query e documentos precisam viver
    no mesmo espaço vetorial).
    """
    embed_model, provider = build_embed_model()
    collection = get_chroma_collection(reset=False)
    vector_store = ChromaVectorStore(chroma_collection=collection)
    index = VectorStoreIndex.from_vector_store(
        vector_store,
        embed_model=embed_model,
    )
    return index, provider


def collection_count() -> int:
    """Quantos chunks já estão no Chroma (0 = índice vazio)."""
    try:
        return get_chroma_collection(reset=False).count()
    except Exception:
        return 0
