# easyRAG

Chat RAG com documentos próprios: Angular no front, AWS serverless no back, PostgreSQL + `pgvector` para busca por similaridade.

## URLs

- App: https://easyrag.fpoiato.com
- API: https://api.easyrag.fpoiato.com

## Arquitetura (custo baixo)

- **Frontend:** Angular 22 + Tailwind, hospedado em S3 + CloudFront.
- **API:** Lambda Function URL com streaming (`RESPONSE_STREAM`) atrás de CloudFront + OAC.
- **Ingestão:** Lambda Python (LlamaParse se houver chave; senão pypdf/texto) + chunking.
- **Embeddings:** Lambda Python com `multilingual-e5-base` (ONNX Xenova, 768 dimensões).
- **Banco:** RDS PostgreSQL 16 `db.t4g.micro` (menor instância), Single-AZ, 20 GB gp3, público para evitar NAT Gateway (~US$ 32/mês).
- **Stop automático:** EventBridge Scheduler às 02:00 America/Sao_Paulo chama uma Lambda que executa `StopDBInstance`. Liga pelo botão em Settings ou `POST /db/start`.

RDS parado ainda cobra storage. A AWS religa instâncias paradas após 7 dias; o job diário volta a desligar.

Não usei Aurora Serverless neste primeiro provisionamento: a menor Aurora ligada custa bem mais, e o pedido foi desligar o RDS manualmente / por agenda.

## Monorepo

```
frontend/                 Angular standalone
backend/infra/           AWS CDK (TypeScript)
backend/lambdas/api/     Chat, presign, sessões, start/stop RDS
backend/lambdas/ingest/   Extração + chunking
backend/lambdas/embed/    multilingual-e5-base → pgvector
backend/lambdas/stop_rds/ Agenda noturna
backend/lambdas/shared/   schema SQL, db, parse, chunking
```

## Deploy

```bash
export AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION=us-east-1
./scripts/deploy.sh
```

Variáveis opcionais no ambiente de deploy:

- `openrouter` / `OPENROUTER_API_KEY` — fallback se o usuário não preencher Settings
- `anthropic` / `ANTHROPIC_API_KEY` — fallback para o provedor Anthropic
- `LLAMA_CLOUD_API_KEY` — ativa extração LlamaParse

O dropdown de Settings usa IDs atuais da Anthropic (`claude-sonnet-5`, `claude-opus-5`, `claude-haiku-4-5`). IDs aposentados como `claude-sonnet-4-20250514` são remapeados automaticamente.

## Endpoints

| Método | Caminho | Uso |
|--------|---------|-----|
| GET | `/health` | liveness |
| GET | `/db` | status do RDS |
| POST | `/db/start` | liga o RDS |
| POST | `/db/stop` | desliga o RDS |
| POST | `/uploads/presign` | URL pré-assinada S3 |
| POST | `/uploads/complete` | dispara ingestão |
| GET | `/documents` | lista arquivos |
| GET | `/sessions` | histórico |
| POST | `/chat` | RAG + streaming SSE |

## Fluxo RAG

1. Browser pede presign → PUT direto no S3 → `complete` ou evento S3 dispara ingestão.
2. Ingestão extrai texto, gera chunks e grava em `chunks`.
3. Embeddings `passage: ...` com e5-base vão para `vector(768)`.
4. A pergunta é embedada com `query: ...`, busca `ORDER BY embedding <=> $1`, e o contexto entra no prompt do provedor escolhido (OpenRouter/OpenAI/Anthropic/Gemini/Grok).
