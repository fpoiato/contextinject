# rag-portfolio

Pipeline educacional de **Retrieval-Augmented Generation** (RAG) para estudar — e demonstrar em portfólio — cada etapa do fluxo, sem esconder o que o framework faz por baixo.

Stack: **LlamaIndex** · **ChromaDB** (local) · **OpenAI embeddings** (ou Voyage) · **GPT-4o / Grok** · **Streamlit**

Sem chave de API o projeto ainda roda em **modo demonstração**: embeddings locais por hashing e resposta extractiva. O pipeline é o mesmo; só muda a qualidade semântica.

```
pergunta do usuário
        │
        ▼
┌───────────────┐     ┌──────────────────┐     ┌─────────────┐
│  1. Ingestão  │ ──▶ │ 2. Indexação     │ ──▶ │  ChromaDB   │
│  PDF / TXT    │     │ chunk + embed    │     │  vetores    │
└───────────────┘     └──────────────────┘     └──────┬──────┘
                                                      │
                      ┌──────────────────┐            │ cosine
                      │ 4. Geração (LLM) │ ◀──────────┤ top-k
                      │ prompt + contexto│     ┌──────┴──────┐
                      └────────┬─────────┘     │ 3. Retrieval│
                               ▼               └─────────────┘
                         resposta citada
```

## O que este repositório ensina

| Etapa | O que acontece | Onde está no código |
| --- | --- | --- |
| Ingestão | Lê PDF/TXT/MD e anexa metadados de fonte | `rag/ingest.py` |
| Indexação | Corta em chunks, gera embeddings, grava no Chroma | `rag/index.py` |
| Retrieval | Embedding da pergunta + similaridade de cosseno | `rag/retrieve.py` |
| Geração | Prompt com os trechos → LLM (ou fallback) | `rag/generate.py` |

Comentários no código cobrem **por que chunking importa**, **como a busca por similaridade funciona** e **a diferença entre retrieval e geração**.

## Estrutura

```
rag-portfolio/
├── app/streamlit_app.py      # interface: chat, busca semântica, explicação
├── scripts/
│   ├── ingest_documents.py   # ingestão + indexação via CLI
│   └── query_rag.py          # retrieval (e geração) via CLI
├── rag/
│   ├── ingest.py
│   ├── index.py
│   ├── retrieve.py
│   ├── generate.py
│   └── pipeline.py           # orquestra as quatro etapas
├── data/sample/              # três textos de exemplo (já versionados)
├── data/raw/                 # coloque os SEUS PDFs/TXT aqui
├── tests/                    # testes do pipeline sem API
├── GUIA.md                   # passo a passo fora do Cursor
└── .env.example
```

## Início rápido

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# opcional: copie e preencha a chave
cp .env.example .env

# índice a partir dos textos de exemplo
python scripts/ingest_documents.py

# só busca semântica (não chama o LLM)
python scripts/query_rag.py "por que chunking é importante?" --retrieve-only

# RAG completo
python scripts/query_rag.py "qual a diferença entre retrieval e geração?"

# interface
streamlit run app/streamlit_app.py --server.port 8517
```

Passo a passo completo (chaves, documentos, experimentos de portfólio): **[GUIA.md](GUIA.md)**.

## Interface

O Streamlit tem três abas:

1. **Conversar** — RAG completo. Cada resposta abre os chunks recuperados e o prompt enviado ao LLM.
2. **Busca semântica** — retrieval isolado, para inspecionar scores sem geração.
3. **Como funciona** — mapa das quatro etapas.

Na barra lateral você ajusta `chunk_size`, `overlap` e `top_k`, envia arquivos e reconstrói o índice.

## Testes

```bash
pytest -q
```

Os testes usam o modo demonstração (sem rede e sem chave): carregam `data/sample/`, indexam no Chroma local e verificam chunking, similaridade e o fluxo `ask()`.

## Licença

Uso livre para estudo e portfólio.
