import os
from functools import lru_cache
from pathlib import Path

import boto3
import psycopg
from botocore.exceptions import ClientError
from psycopg.rows import dict_row

SCHEMA_PATH = Path(__file__).with_name("schema.sql")


class DatabaseUnavailableError(RuntimeError):
    def __init__(self, message: str, *, stopped: bool = False) -> None:
        super().__init__(message)
        self.stopped = stopped


@lru_cache(maxsize=1)
def _secret() -> dict[str, str]:
    secret_arn = os.environ["DB_SECRET_ARN"]
    client = boto3.client("secretsmanager")
    try:
        payload = client.get_secret_value(SecretId=secret_arn)
    except ClientError as exc:
        raise DatabaseUnavailableError("Could not load database credentials") from exc
    import json

    return json.loads(payload["SecretString"])


def connect() -> psycopg.Connection:
    secret = _secret()
    host = os.environ.get("DB_HOST") or secret.get("host")
    port = int(os.environ.get("DB_PORT") or secret.get("port") or 5432)
    try:
        conn = psycopg.connect(
            host=host,
            port=port,
            user=secret["username"],
            password=secret["password"],
            dbname=secret.get("dbname") or os.environ.get("DB_NAME", "easyrag"),
            sslmode="require",
            connect_timeout=8,
            row_factory=dict_row,
        )
    except psycopg.OperationalError as exc:
        text = str(exc).lower()
        stopped = any(
            token in text
            for token in ("connection refused", "timeout", "could not translate host", "stopped")
        )
        raise DatabaseUnavailableError(
            "Database is stopped or unreachable. Start it from Settings.",
            stopped=stopped,
        ) from exc
    return conn


def ensure_schema(conn: psycopg.Connection) -> None:
    sql = SCHEMA_PATH.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()
