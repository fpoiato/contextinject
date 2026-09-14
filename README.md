# contextinject

SaaS de chat RAG com documentos próprios: Angular no front, AWS serverless no back, PostgreSQL + `pgvector` para busca por similaridade, Cognito para autenticação e BYOK (bring your own key) para os modelos.

## URLs

- Site + app: https://contextinject.fpoiato.com (`/`, `/pricing`, `/faq`, `/terms`, `/privacy`, `/app`)
- API: https://api.contextinject.fpoiato.com
- URLs antigas (`easyrag.fpoiato.com` / `api.easyrag.fpoiato.com`) redirecionam ou continuam apontando para o mesmo CloudFront.

## Arquitetura (custo baixo)

- **Frontend:** Angular 22 + Tailwind, hospedado em S3 + CloudFront. Área pública (landing, pricing, FAQ, termos, privacidade) e workspace autenticado em `/app`.
- **Auth:** Cognito User Pool (`contextinject-users`) **sem Hosted UI**. O Angular tem telas próprias (`/login`, `/signup`, `/verify`, `/forgot`, `/reset`). Uma Lambda de auth chama as Admin APIs do Cognito (`AdminInitiateAuth`, signup/confirm/forgot) e o **API Gateway HTTP** publica `POST /auth/*`. O CloudFront de `api.contextinject.fpoiato.com` encaminha `/auth*` para esse API. Códigos de verificação e reset saem pelo Amazon SES do domínio `fpoiato.com` (`noreply@fpoiato.com`). O front guarda o ID token e envia `Authorization: Bearer`; a API de chat valida com `aws-jwt-verify`. Grupo `admin` libera `POST /db/stop`.
- **Tenancy:** `users` → `projects` → `folders` (árvore) → `documents`/`chunks`/`chat_sessions`. Toda query filtra por `user_id` (o `sub` do Cognito). Chaves S3: `uploads/{sub}/{projectId}/{documentId}/{filename}`.
- **BYOK:** cada usuário guarda suas chaves (OpenRouter, OpenAI, Anthropic, Gemini, Grok) em um secret próprio do Secrets Manager (`easyrag/users/{sub}/llm-keys`). A chave nunca volta ao browser; o chat usa a chave do provedor escolhido, com fallback para a chave OpenRouter.
- **Planos (por armazenamento):** Starter US$ 10/mês até 1 GB · Pro US$ 50/mês até 50 GB · Business US$ 100/mês até 200 GB · acima disso, contato. O limite é checado no presign (tamanho declarado) e confirmado na ingestão (tamanho real; excedente é apagado e marcado como erro). Cobrança (Stripe) ainda não está ligada: todo usuário novo nasce em `starter`; o plano é a coluna `users.plan`.
- **API:** Lambda Function URL com streaming (`RESPONSE_STREAM`) atrás de CloudFront + OAC.
- **Ingestão:** Lambda Python invocada por `POST /uploads/complete` (sem trigger S3), lê dono/projeto da linha em `documents`, extrai texto (LlamaParse se houver chave; senão pypdf/texto) e faz chunking.
- **Embeddings:** Lambda Python com `multilingual-e5-base` (ONNX Xenova, 768 dimensões).
- **Banco:** RDS PostgreSQL 16 `db.t4g.micro`, Single-AZ, 20 GB gp3, público para evitar NAT Gateway. O stack CloudFormation continua `EasyRagStack` e o instance id `easyrag-pg` (renomear esses IDs recriaria o banco).
- **Stop automático:** EventBridge Scheduler às 02:00 America/Sao_Paulo desliga o RDS. Qualquer usuário autenticado pode religar em Account → Database (`POST /db/start`); só admin desliga.

## Monorepo

```
frontend/                 Angular standalone (public/, auth/, workspace/, chat/, account/)
backend/infra/            AWS CDK (TypeScript): Cognito, RDS, S3, CloudFront, Lambdas, Scheduler
backend/lambdas/api/      Auth de negócio, projetos, pastas, documentos, chaves BYOK, chat, start/stop RDS
backend/lambdas/auth/     Login/signup/reset: Admin APIs do Cognito atrás do API Gateway HTTP
backend/lambdas/ingest/   Extração + chunking (lê a row de documents)
backend/lambdas/embed/    multilingual-e5-base → pgvector
backend/lambdas/stop_rds/ Agenda noturna
backend/lambdas/shared/   schema.sql (idempotente, usado por Node e Python), db, parse, chunking
```

## Deploy

```bash
export AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION=us-east-1
./scripts/deploy.sh
```

Variável opcional no ambiente de deploy: `LLAMA_CLOUD_API_KEY` (ativa extração LlamaParse). Não existe mais chave de LLM da plataforma: cada usuário cadastra a própria em Account → API keys.

Para tornar um usuário admin (pode desligar o banco):

```bash
aws cognito-idp admin-add-user-to-group --user-pool-id <UserPoolId> --group-name admin --username <email>
```

O `schema.sql` é aplicado a cada cold start (`CREATE ... IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`), então mudanças de schema entram no deploy sem passo manual.

## Endpoints

Todos exigem `Authorization: Bearer <id token>` exceto `/health`, `/config` e `POST /auth/*`.

| Método | Caminho | Uso |
|--------|---------|-----|
| POST | `/auth/signup` · `/auth/confirm` · `/auth/resend` | cadastro e confirmação de e-mail (Lambda → Cognito) |
| POST | `/auth/login` · `/auth/challenge` · `/auth/refresh` · `/auth/logout` | sessão via `AdminInitiateAuth` (sem Hosted UI) |
| POST | `/auth/forgot` · `/auth/reset` | recuperação de senha |
| GET | `/config` | user pool, client id, planos |
| GET / PATCH | `/me` | perfil, plano, uso, chaves (mascaradas), settings |
| GET | `/me/keys` · PUT/DELETE `/me/keys/:provider` | chaves BYOK no Secrets Manager |
| GET | `/db` · POST `/db/start` · POST `/db/stop` (admin) | RDS |
| GET / POST | `/projects` · PATCH/DELETE `/projects/:id` | projetos |
| GET | `/projects/:id/tree` | pastas + documentos do projeto |
| POST | `/projects/:id/folders` · PATCH/DELETE `/folders/:id` | pastas (renomear, mover, excluir recursivo) |
| POST | `/projects/:id/uploads/presign` | cria `documents` row + URL pré-assinada (checa quota) |
| POST | `/uploads/complete` | dispara ingestão do `documentId` |
| PATCH / DELETE | `/documents/:id` | renomear, mover de pasta, excluir (S3 + índice) |
| GET | `/projects/:id/sessions` · GET/DELETE `/sessions/:id` | histórico por projeto |
| POST | `/chat` | RAG + streaming SSE, escopo por `projectId` e opcionalmente `folderId` (inclui subpastas) |

## Fluxo RAG

1. Browser pede presign (projeto/pasta/tamanho) → PUT direto no S3 → `complete` invoca a ingestão.
2. Ingestão confere quota com o tamanho real, extrai texto, gera chunks e grava em `chunks` com `project_id`.
3. Embeddings `passage: ...` com e5-base vão para `vector(768)`.
4. A pergunta é embedada com `query: ...`, busca `ORDER BY embedding <=> $1` filtrando `user_id`, `project_id` e (opcional) subárvore de pastas, e o contexto entra no prompt do provedor escolhido com a chave do usuário.

O dropdown de modelos usa IDs atuais dos provedores; IDs aposentados (ex.: `claude-sonnet-4-20250514`) são remapeados automaticamente no front e no back.
