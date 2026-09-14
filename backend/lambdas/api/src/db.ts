import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import pg from "pg";
import SCHEMA_SQL from "../../shared/schema.sql";

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

function isConnectivityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|timeout|ENOTFOUND|EHOSTUNREACH|ECONNRESET|Connection terminated|stopped|getaddrinfo/i.test(
    message,
  );
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  let db: pg.Pool;
  try {
    db = await getPool();
    if (!schemaReady) {
      await db.query(SCHEMA_SQL);
      schemaReady = true;
    }
  } catch (error) {
    throw new DatabaseUnavailableError(
      "Database is stopped or unreachable. Start it from Settings.",
      isConnectivityError(error),
    );
  }
  try {
    return await db.query<T>(text, params);
  } catch (error) {
    if (isConnectivityError(error)) {
      throw new DatabaseUnavailableError("Database is stopped or unreachable. Start it from Settings.", true);
    }
    throw error;
  }
}

export function toSqlVector(values: number[]): string {
  return `[${values.map((value) => value.toFixed(8)).join(",")}]`;
}
