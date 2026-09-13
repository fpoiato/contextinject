# Guia sequencial — o que fazer fora do Cursor

Este arquivo é o roteiro para rodar o **rag-portfolio** na sua máquina, entender cada etapa e ter material de portfólio. Siga na ordem.

---

## 0. O que você vai ter no final

- Um índice local (ChromaDB) com os seus documentos.
- Um script que mostra **busca semântica** (retrieval) sem chamar o LLM.
- Um script e um app Streamlit que fazem o RAG completo.
- Clareza sobre o que é chunking, embedding, cosseno, retrieval e geração.

Você **não precisa** de GPU. Precisa de Python 3.10+ e, para a versão “de verdade”, uma chave de API (Cursor, OpenAI, Voyage e/ou xAI).

---

## 1. Instalar o Python e o projeto

No terminal, na pasta do repositório:

```bash
python3 --version          # 3.10 ou mais novo
python3 -m venv .venv
source .venv/bin/activate  # Windows (PowerShell): .venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt
```

Confirme:

```bash
python -c "import llama_index, chromadb, streamlit; print('ok')"
```

Se o `venv` não ativar no Windows, use o Python do venv direto:

```text
.venv\Scripts\python.exe scripts\ingest_documents.py
```

---

## 2. Configurar chaves de API

Copie o modelo de ambiente:

```bash
cp .env.example .env
```

Abra `.env` num editor e escolha **um** cenário:

### Cenário A — recomendado para portfólio (OpenAI)

1. Crie uma chave em [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
2. Cole em `OPENAI_API_KEY=sk-...`
3. Deixe os modelos padrão:
   - embeddings: `text-embedding-3-small` (barato e suficiente)
   - LLM: `gpt-4o`

### Cenário B — embeddings Voyage + LLM OpenAI

Descomente no `.env`:

```text
VOYAGE_API_KEY=pa-...
VOYAGE_EMBEDDING_MODEL=voyage-3
OPENAI_API_KEY=sk-...
```

O código usa Voyage para vetores e OpenAI para gerar o texto.

### Cenário C — Grok (xAI) como LLM

```text
OPENAI_API_KEY=sk-...          # ainda usado nos embeddings, se Voyage não estiver setado
XAI_API_KEY=xai-...
XAI_LLM_MODEL=grok-3
```

A geração passa a chamar `https://api.x.ai/v1` com o SDK da OpenAI.

### Cenário D — Cursor como LLM

A chave do Cursor **não** substitui a OpenAI nos embeddings: o Cursor SDK é um agente, não um endpoint de `chat.completions`. Aqui ela entra só na geração, com `tools=[]` (só texto, sem editar arquivos).

1. Crie a chave em [cursor.com/dashboard](https://cursor.com/dashboard) → Integrations / API Keys.
2. No `.env`:

```text
CURSOR_API_KEY=cursor_...
CURSOR_LLM_MODEL=composer-2.5
```

3. Instale o extra: `pip install cursor-sdk`
4. Embeddings continuam Voyage, OpenAI ou hashing local.

Se `CURSOR_API_KEY` estiver definida, ela tem prioridade sobre xAI e OpenAI na geração.

### Cenário E — zero chave (modo demonstração)

Não crie `.env`. O projeto:

- gera embeddings com um hashing de n-gramas (`rag/embeddings.py`);
- “gera” a resposta recortando frases dos chunks recuperados.

Serve para aprender o pipeline. **Não** use este modo como prova de qualidade semântica no portfólio — deixe explícito que é um fallback.

Nunca commite o arquivo `.env`. Ele já está no `.gitignore`.

---

## 3. Adicionar documentos

Há duas pastas:

| Pasta | Função |
| --- | --- |
| `data/sample/` | Três textos sobre RAG, já no git. Use-os no primeiro run. |
| `data/raw/` | Os **seus** arquivos. A ingestão prefere esta pasta se ela não estiver vazia. |

Formatos aceitos: `.pdf`, `.txt`, `.md`.

Sugestão para o primeiro teste (sem PDF nenhum):

1. Rode a ingestão sem argumentos — ela cai em `data/sample/`.
2. Depois jogue 2–5 PDFs **seus** (um artigo, um README, um manual curto) em `data/raw/`.
3. Rode a ingestão de novo. O índice é recriado do zero (comportamento previsível para estudo).

Pela interface Streamlit você também pode enviar arquivos: eles são gravados em `data/raw/`.

Dicas de qualidade do acervo:

- Prefira texto selecionável (PDF “digital”), não scan sem OCR.
- Evite dezenas de livros na primeira versão; um dossiê pequeno demonstra melhor o retrieval.
- Dê nomes de arquivo claros (`manual_onboarding.pdf`) — eles aparecem como citação.

---

## 4. Rodar cada parte do projeto

Sempre com o venv ativado, **na raiz do repositório**.

### 4.1 Ingestão + indexação

```bash
python scripts/ingest_documents.py
```

O que acontece de verdade:

1. Lê PDF/TXT (`rag/ingest.py`).
2. Corta em chunks com overlap (`SentenceSplitter`).
3. Embedda cada chunk (OpenAI, Voyage ou hashing).
4. Grava os vetores em `chroma_db/` (Chroma persistente, arquivo local — não é um servidor).

Experimente tamanhos:

```bash
python scripts/ingest_documents.py --chunk-size 256 --chunk-overlap 32
python scripts/ingest_documents.py --input data/raw
```

Saída esperada: número de documentos, número de chunks, provedor de embedding.

### 4.2 Retrieval isolado (semantic search)

```bash
python scripts/query_rag.py "por que chunking é importante?" --retrieve-only
```

Esta linha **não chama o LLM**. Você deve ver 3 trechos com `score` (similaridade) e `fonte`. Compare:

```bash
python scripts/query_rag.py "receita de lasanha" --retrieve-only
```

Os scores devem cair — o índice não tem lasanha. Anote isso: é evidência de que a busca é por similaridade, não um chat genérico.

### 4.3 RAG completo na linha de comando

```bash
python scripts/query_rag.py "qual a diferença entre retrieval e geração?"
```

Primeiro imprime os chunks, depois a resposta. Se estiver em modo demonstração, a resposta avisa que não há LLM.

### 4.4 Interface Streamlit

```bash
streamlit run app/streamlit_app.py --server.port 8517
```

Abra o URL que o terminal mostrar (em geral `http://localhost:8517`).

Use nesta ordem:

1. Sidebar → **Usar exemplos** (ou envie PDFs e clique **Ingerir e indexar**).
2. Aba **Busca semântica** → uma consulta → olhe os scores.
3. Aba **Conversar** → a mesma pergunta → abra “Trechos recuperados” e “Prompt enviado à geração”.
4. Aba **Como funciona** → relacione o que você viu com as quatro etapas.
5. Mexa em `chunk_size` / `top_k`, reindexe, repita a pergunta. Anote o que mudou.

### 4.5 Testes automatizados

```bash
pytest -q
```

Não usam chave de API. Se falharem, a ingestão ou o Chroma local está quebrado — resolva isso antes de debugar o LLM.

---

## 5. Como explicar isto numa entrevista / README de portfólio

Roteiro curto:

1. “O LLM não lê meus PDFs. Quem lê é o retriever.”
2. “Chunking existe porque um vetor só não representa um livro inteiro.”
3. “Embedding coloca pergunta e trechos no mesmo espaço; cosseno escolhe os vizinhos.”
4. “Geração é um prompt com esses vizinhos. Se o retrieval erra, a resposta erra.”
5. Mostre a aba Conversar com os expanders de chunk + prompt.

Coloque no seu portfólio: este repositório, um GIF do Streamlit, e uma tabela pequena (chunk_size × qualidade percebida em 5 perguntas). Isso demonstra domínio melhor do que um chat sem inspeção.

---

## 6. Experimentos para demonstrar domínio

Faça pelo menos três e registre o resultado (planilha ou seção no README pessoal):

1. **Chunk size** — 128 vs 512 vs 1024 nas mesmas 8 perguntas. Qual Recall@3 visual (o trecho certo veio?) é melhor?
2. **Overlap** — 0 vs 64. Ache uma definição que é cortada no meio com overlap 0 e sobrevive com 64.
3. **top_k** — 1 vs 5. top_k=1 falha em perguntas que precisam de dois parágrafos; top_k=5 às vezes polui o prompt.
4. **Provedor de embedding** — modo demo (hashing) vs `text-embedding-3-small`. Pergunte com um sinônimo que **não** aparece no texto (“por que fragmentar documentos?” em vez de “chunking”). O hashing tende a falhar; o modelo neural, não.
5. **Pergunta fora do acervo** — “qual o capital da França?” com os textos de RAG. A geração deve recusar se o prompt estiver correto.
6. **PDF ruim** — um scan ou um slide com pouco texto. Veja o lixo que entra no índice. Extra: limpar cabeçalhos antes de indexar.
7. **Rerank** (avançado) — depois do Chroma, passe os 10 primeiros chunks num cross-encoder e fique com 3. Compare com o top-3 cru.
8. **Métricas** — monte 10 pares (pergunta, arquivo esperado) e calcule Recall@k na mão. É o experimento que mais impressiona.

---

## 7. Problemas frequentes

| Sintoma | O que checar |
| --- | --- |
| `O índice está vazio` | Rode `ingest_documents.py` ou o botão **Ingerir** no Streamlit. |
| Respostas genéricas / alucinadas | Abra os chunks. Se estiverem errados, o problema é retrieval (chunking, embedding, acervo), não o LLM. |
| `Incorrect API key` / 401 | `.env` na **raiz**, venv ativado, chave sem aspas extras. Reinicie o Streamlit depois de editar `.env`. |
| PDF “não tem texto” | É imagem. Passe OCR (não incluso neste projeto) ou use `.txt`. |
| Mudou o modelo de embedding e a busca piorou | Reindexe. Query e documentos precisam do mesmo espaço vetorial. |
| `chroma_db` enorme | Apague a pasta e ingira de novo; é regenerável. |

---

## 8. Próximo passo (depois que o básico funcionar)

Quando as quatro etapas estiverem claras, o upgrade natural não é “mais um framework”. É:

- um arquivo `eval/perguntas.json` com gabarito de fontes;
- um script que imprime Recall@k;
- um reranker;
- metadados filtráveis (ex.: buscar só em `data/raw/manuais/`).

Isso continua no mesmo desenho: ingestão, índice, retrieval, geração — só que mensurável.
