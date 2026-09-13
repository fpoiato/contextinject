"""
rag-portfolio — interface Streamlit.

Três abas, uma para cada forma de olhar o pipeline:

- Conversar: RAG completo (retrieval + geração)
- Busca semântica: só retrieval, para ver similaridade sem o LLM
- Como funciona: o mapa mental das quatro etapas
"""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from rag.config import ChunkingConfig, RAW_DIR, RetrievalConfig  # noqa: E402
from rag.ingest import list_source_files  # noqa: E402
from rag.pipeline import RagPipeline  # noqa: E402

st.set_page_config(
    page_title="rag-portfolio",
    page_icon="📚",
    layout="wide",
)

CUSTOM_CSS = """
<style>
    .block-container { padding-top: 1.4rem; max-width: 1200px; }
    .hero {
        background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 55%, #124e4a 100%);
        color: #f8fafc;
        border-radius: 18px;
        padding: 1.6rem 1.8rem;
        margin-bottom: 1.2rem;
    }
    .hero h1 { color: #f8fafc; margin: 0 0 0.35rem 0; font-size: 1.9rem; }
    .hero p { color: #cbd5e1; margin: 0; }
    .step-card {
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 0.9rem 1rem;
        background: #fff;
        height: 100%;
    }
    .step-card h3 { margin: 0 0 0.4rem 0; font-size: 1rem; }
    .muted { color: #64748b; font-size: 0.92rem; }
    .chunk {
        border-left: 4px solid #0f766e;
        background: #f0fdfa;
        padding: 0.75rem 0.9rem;
        border-radius: 0 10px 10px 0;
        margin-bottom: 0.75rem;
    }
</style>
"""


def pipeline_from_state() -> RagPipeline:
    return RagPipeline(
        chunking=ChunkingConfig(
            chunk_size=st.session_state.chunk_size,
            chunk_overlap=st.session_state.chunk_overlap,
        ),
        retrieval=RetrievalConfig(top_k=st.session_state.top_k),
    )


def ensure_defaults() -> None:
    st.session_state.setdefault("chunk_size", 512)
    st.session_state.setdefault("chunk_overlap", 64)
    st.session_state.setdefault("top_k", 3)
    st.session_state.setdefault("messages", [])
    st.session_state.setdefault("last_ingest", None)


def render_chunks(chunks) -> None:
    if not chunks:
        st.info("Nenhum trecho recuperado. Ingira documentos e tente outra pergunta.")
        return
    for i, chunk in enumerate(chunks, start=1):
        score = f"{chunk.score:.3f}" if chunk.score is not None else "?"
        st.markdown(
            f'<div class="chunk"><strong>Trecho {i}</strong> · '
            f"fonte <code>{chunk.source}</code> · similaridade <code>{score}</code></div>",
            unsafe_allow_html=True,
        )
        st.write(chunk.text)


def main() -> None:
    ensure_defaults()
    st.markdown(CUSTOM_CSS, unsafe_allow_html=True)

    st.markdown(
        """
        <div class="hero">
          <h1>rag-portfolio</h1>
          <p>Pipeline educacional de Retrieval-Augmented Generation —
          ingestão, embeddings, busca por similaridade e geração, etapa por etapa.</p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    with st.sidebar:
        st.subheader("Índice")
        pipeline = pipeline_from_state()
        status = pipeline.status()

        mode_label = (
            "Modo demonstração (sem API)"
            if status["demo_mode"]
            else "Modo API"
        )
        st.metric("Chunks indexados", status["indexed_chunks"])
        st.caption(
            f"{mode_label} · embedding `{status['embed_provider']}` · "
            f"LLM `{status['llm_provider']}`"
        )
        if status["demo_mode"]:
            st.info(
                "Sem chave de LLM (`CURSOR_API_KEY`, `OPENAI_API_KEY` ou "
                "`XAI_API_KEY`) o app usa embeddings locais (hashing) e uma "
                "resposta extractiva. O pipeline é o mesmo; só muda a "
                "qualidade semântica. Veja o GUIA.md."
            )
        elif status["embed_provider"] == "mock":
            st.info(
                "A geração usa um LLM, mas os embeddings ainda são hashing "
                "local. Para busca semântica melhor, defina `OPENAI_API_KEY` "
                "ou `VOYAGE_API_KEY`. A chave do Cursor não faz embeddings."
            )

        st.divider()
        st.subheader("Parâmetros")
        st.session_state.chunk_size = st.slider(
            "Tamanho do chunk",
            min_value=128,
            max_value=1024,
            value=st.session_state.chunk_size,
            step=64,
            help="Chunks grandes guardam mais contexto; chunks pequenos acertam trechos mais específicos.",
        )
        st.session_state.chunk_overlap = st.slider(
            "Overlap",
            min_value=0,
            max_value=256,
            value=st.session_state.chunk_overlap,
            step=16,
            help="Repete tokens entre chunks vizinhos para não cortar uma ideia no meio.",
        )
        st.session_state.top_k = st.slider(
            "Top-k (quantos trechos recuperar)",
            min_value=1,
            max_value=8,
            value=st.session_state.top_k,
        )

        st.divider()
        st.subheader("Documentos")
        uploads = st.file_uploader(
            "Enviar PDF, TXT ou MD",
            type=["pdf", "txt", "md"],
            accept_multiple_files=True,
        )
        if uploads:
            RAW_DIR.mkdir(parents=True, exist_ok=True)
            saved = []
            for uploaded in uploads:
                target = RAW_DIR / uploaded.name
                target.write_bytes(uploaded.getvalue())
                saved.append(uploaded.name)
            st.success("Salvo em data/raw: " + ", ".join(saved))

        raw_files = [path.name for path in list_source_files(RAW_DIR)]
        if raw_files:
            st.caption("Em data/raw/: " + ", ".join(raw_files))
        else:
            st.caption("data/raw está vazia — a ingestão usará data/sample/.")

        col_a, col_b = st.columns(2)
        with col_a:
            ingest_clicked = st.button("Ingerir e indexar", type="primary", use_container_width=True)
        with col_b:
            sample_clicked = st.button("Usar exemplos", use_container_width=True)

        if ingest_clicked or sample_clicked:
            with st.spinner("Chunking + embeddings + ChromaDB..."):
                try:
                    pipeline = pipeline_from_state()
                    input_dir = ROOT / "data" / "sample" if sample_clicked else None
                    summary = pipeline.ingest(input_dir=input_dir, reset=True)
                    st.session_state.last_ingest = summary
                    st.session_state.messages = []
                    st.success(
                        f"{summary['chunks']} chunks de {summary['documents']} documento(s). "
                        f"Embedding: {summary['embed_provider']}."
                    )
                except Exception as exc:
                    st.error(str(exc))

        if st.session_state.last_ingest:
            sources = st.session_state.last_ingest.get("sources") or []
            st.caption("Fontes: " + ", ".join(sources))

    tab_chat, tab_search, tab_howto = st.tabs(
        ["Conversar (RAG completo)", "Busca semântica", "Como funciona"]
    )

    with tab_chat:
        st.markdown(
            "Faça uma pergunta. O app **recupera** trechos parecidos e depois "
            "**gera** a resposta. Os chunks aparecem abaixo da mensagem para "
            "você auditar o retrieval."
        )
        for message in st.session_state.messages:
            with st.chat_message(message["role"]):
                st.markdown(message["content"])
                if message.get("chunks"):
                    with st.expander("Trechos recuperados (retrieval)"):
                        render_chunks(message["chunks"])
                    if message.get("prompt"):
                        with st.expander("Prompt enviado à geração"):
                            st.code(message["prompt"], language="markdown")

        question = st.chat_input("Ex.: Por que chunking é importante no RAG?")
        if question:
            st.session_state.messages.append({"role": "user", "content": question})
            pipeline = pipeline_from_state()
            try:
                if pipeline.indexed_chunks == 0:
                    with st.spinner("Índice vazio — ingerindo os documentos de exemplo..."):
                        pipeline.ingest(reset=True)
                result = pipeline.ask(question)
                assistant = {
                    "role": "assistant",
                    "content": result.answer,
                    "chunks": result.chunks,
                    "prompt": result.generation.prompt,
                }
            except Exception as exc:
                assistant = {"role": "assistant", "content": f"Erro: {exc}"}
            st.session_state.messages.append(assistant)
            st.rerun()

    with tab_search:
        st.markdown(
            "Esta aba **não chama o LLM**. Só executa similaridade de cosseno "
            "no ChromaDB — a etapa de retrieval isolada."
        )
        query = st.text_input("Consulta semântica", placeholder="chunking overlap embeddings")
        if st.button("Buscar chunks", type="primary"):
            pipeline = pipeline_from_state()
            try:
                if pipeline.indexed_chunks == 0:
                    pipeline.ingest(reset=True)
                chunks = pipeline.search(query)
                st.caption(
                    f"{len(chunks)} resultado(s) · top-k={st.session_state.top_k} · "
                    "score mais alto = mais semelhante à consulta"
                )
                render_chunks(chunks)
            except Exception as exc:
                st.error(str(exc))

    with tab_howto:
        cols = st.columns(4)
        steps = [
            ("1. Ingestão", "PDFs e TXT viram texto bruto com metadados de fonte. Ainda não há vetores."),
            ("2. Indexação", "O texto é cortado em chunks, cada chunk vira um embedding e o Chroma guarda o vetor."),
            ("3. Retrieval", "A pergunta também vira vetor. Cosseno escolhe os top-k chunks mais próximos."),
            ("4. Geração", "O LLM recebe só esses trechos + a pergunta. Sem retrieval, ele chutaria."),
        ]
        for col, (title, body) in zip(cols, steps):
            with col:
                st.markdown(
                    f'<div class="step-card"><h3>{title}</h3>'
                    f'<p class="muted">{body}</p></div>',
                    unsafe_allow_html=True,
                )

        st.markdown("### Por que chunking?")
        st.markdown(
            """
            Um documento inteiro num único vetor mistura todos os assuntos numa
            média. Na busca, quase nada fica *especificamente* parecido com a
            pergunta. Chunks do tamanho de um parágrafo (com overlap) deixam
            cada vetor representar uma ideia só — e o retriever consegue
            devolver exatamente o trecho útil.
            """
        )
        st.markdown("### Retrieval ≠ geração")
        st.markdown(
            """
            - **Retrieval** escolhe evidências no *seu* acervo (Chroma + embeddings).
            - **Geração** redige a resposta (Cursor, GPT-4o, Grok ou o fallback extractivo).

            O prompt da aba Conversar deixa essa fronteira visível: o modelo
            só vê o que o retriever selecionou.
            """
        )


if __name__ == "__main__":
    main()
