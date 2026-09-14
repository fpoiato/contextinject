import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import pg from "pg";

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'local',
  filename TEXT NOT NULL,
  content_type TEXT,
  s3_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  bytes BIGINT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL DEFAULT 'local',
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  page INT,
  embedding vector(768),
  token_count INT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chunks_document_id_idx ON chunks (document_id);
CREATE INDEX IF NOT EXISTS chunks_user_id_idx ON chunks (user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'chunks_embedding_hnsw_idx'
  ) THEN
    CREATE INDEX chunks_embedding_hnsw_idx
      ON chunks USING hnsw (embedding vector_cosine_ops);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'local',
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL DEFAULT 'local',
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  sources JSONB,
  model TEXT,
  prompt_tokens INT,
  completion_tokens INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_history_session_idx ON chat_history (session_id, created_at);
`;

const { Pool } = pg;

export class DatabaseUnavailableError extends Error {
  readonly stopped: boolean;
  constructor(message: string, stopped = true) {
    super(message);
    this.name = "DatabaseUnavailableError";
    this.stopped = stopped;
  }
}

interface DbSecret {
  username: string;
  password: string;
  host?: string;
  port?: number | string;
  dbname?: string;
}

const secrets = new SecretsManagerClient({});
let cachedSecret: DbSecret | undefined;
let pool: pg.Pool | undefined;
let schemaReady = false;

async function secret(): Promise<DbSecret> {
  if (cachedSecret) {
    return cachedSecret;
  }
  const response = await secrets.send(
    new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }),
  );
  cachedSecret = JSON.parse(response.SecretString ?? "{}") as DbSecret;
  return cachedSecret;
}

export async function getPool(): Promise<pg.Pool> {
  if (pool) {
    return pool;
  }
  const creds = await secret();
  pool = new Pool({
    host: process.env.DB_HOST || creds.host,
    port: Number(process.env.DB_PORT || creds.port || 5432),
    user: creds.username,
    password: creds.password,
    database: process.env.DB_NAME || creds.dbname || "easyrag",
    ssl: { rejectUnauthorized: false },
    max: 4,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10000,
  });
  pool.on("error", () => {
    pool = undefined;
    schemaReady = false;
  });
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  try {
    const db = await getPool();
    if (!schemaReady) {
      await ensureSchema(db);
    }
    return await db.query<T>(text, params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stopped = /ECONNREFUSED|timeout|ENOTFOUND|EHOSTUNREACH|Connection terminated|stopped/i.test(
      message,
    );
    throw new DatabaseUnavailableError(
      "Database is stopped or unreachable. Start it from Settings.",
      stopped,
    );
  }
}

async function ensureSchema(db: pg.Pool): Promise<void> {
  await db.query(SCHEMA_SQL);
  schemaReady = true;
}

export function toSqlVector(values: number[]): string {
  return `[${values.map((value) => value.toFixed(8)).join(",")}]`;
}
