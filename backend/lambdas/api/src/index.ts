import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { DatabaseUnavailableError, query } from "./db.js";
import { buildRagMessages, searchChunks } from "./rag.js";
import { streamChat } from "./llm.js";
import { dbStatus, startDb, stopDb } from "./rds-admin.js";

const s3 = new S3Client({});
const lambda = new LambdaClient({});

declare const awslambda: {
  streamifyResponse: (
    handler: (
      event: APIGatewayProxyEventV2,
      responseStream: NodeJS.WritableStream,
      context: Context,
    ) => Promise<void>,
  ) => unknown;
  HttpResponseStream: {
    from: (
      stream: NodeJS.WritableStream,
      metadata: { statusCode: number; headers: Record<string, string> },
    ) => NodeJS.WritableStream;
  };
};

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://easyrag.fpoiato.com";

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": ALLOWED_ORIGIN,
    "access-control-allow-headers": "content-type,authorization,x-api-key,x-user-id,x-model,x-provider",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  };
}

function jsonStream(
  responseStream: NodeJS.WritableStream,
  statusCode: number,
  body: unknown,
): NodeJS.WritableStream {
  return awslambda.HttpResponseStream.from(responseStream, {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

function writeJson(stream: NodeJS.WritableStream, statusCode: number, body: unknown): void {
  const out = jsonStream(stream, statusCode, body);
  out.write(JSON.stringify(body));
  out.end();
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> {
  if (!event.body) {
    return {};
  }
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function userId(event: APIGatewayProxyEventV2): string {
  return event.headers["x-user-id"] || event.headers["X-User-Id"] || "local";
}

function header(event: APIGatewayProxyEventV2, name: string): string | undefined {
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(event.headers)) {
    if (key.toLowerCase() === expected && value) {
      return value;
    }
  }
  return undefined;
}

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const method = event.requestContext.http.method.toUpperCase();
  const path = (event.rawPath || "/").replace(/\/+$/, "") || "/";

  if (method === "OPTIONS") {
    writeJson(responseStream, 204, {});
    return;
  }

  try {
    if (method === "GET" && path === "/health") {
      writeJson(responseStream, 200, { ok: true, service: "easyrag" });
      return;
    }
    if (method === "GET" && path === "/db") {
      writeJson(responseStream, 200, await dbStatus());
      return;
    }
    if (method === "POST" && path === "/db/start") {
      writeJson(responseStream, 200, await startDb());
      return;
    }
    if (method === "POST" && path === "/db/stop") {
      writeJson(responseStream, 200, await stopDb());
      return;
    }
    if (method === "POST" && path === "/uploads/presign") {
      writeJson(responseStream, 200, await presign(event));
      return;
    }
    if (method === "POST" && path === "/uploads/complete") {
      writeJson(responseStream, 202, await completeUpload(event));
      return;
    }
    if (method === "GET" && path === "/documents") {
      writeJson(responseStream, 200, await listDocuments(event));
      return;
    }
    if (method === "GET" && path === "/sessions") {
      writeJson(responseStream, 200, await listSessions(event));
      return;
    }
    if (method === "GET" && path.startsWith("/sessions/")) {
      writeJson(responseStream, 200, await getSession(event, path.split("/")[2] ?? ""));
      return;
    }
    if (method === "POST" && path === "/chat") {
      await handleChat(event, responseStream);
      return;
    }
    writeJson(responseStream, 404, { error: "Not found" });
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) {
      writeJson(responseStream, 503, { error: error.message, code: "DB_STOPPED", stopped: error.stopped });
      return;
    }
    const message = error instanceof Error ? error.message : "Internal error";
    writeJson(responseStream, 500, { error: message });
  }
});

async function presign(event: APIGatewayProxyEventV2) {
  const body = parseBody(event);
  const filename = String(body.filename || "document.bin").replace(/[^\w.\- ()]/g, "_");
  const contentType = String(body.contentType || "application/octet-stream");
  const key = `uploads/${userId(event)}/${randomUUID()}/${filename}`;
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: process.env.DOCUMENTS_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 900 },
  );
  return { url, key, filename, contentType };
}

async function completeUpload(event: APIGatewayProxyEventV2) {
  const body = parseBody(event);
  const key = String(body.key || "");
  if (!key) {
    throw new Error("key is required");
  }
  await lambda.send(
    new InvokeCommand({
      FunctionName: process.env.INGEST_FUNCTION_NAME,
      InvocationType: "Event",
      Payload: Buffer.from(
        JSON.stringify({
          s3_key: key,
          filename: body.filename,
          content_type: body.contentType,
          user_id: userId(event),
        }),
      ),
    }),
  );
  return { ok: true, status: "processing" };
}

async function listDocuments(event: APIGatewayProxyEventV2) {
  const result = await query(
    `
    SELECT id, filename, status, bytes, error, created_at, updated_at
    FROM documents
    WHERE $1::text = 'local' OR user_id = $1
    ORDER BY created_at DESC
    LIMIT 50
    `,
    [userId(event)],
  );
  return { documents: result.rows };
}

async function listSessions(event: APIGatewayProxyEventV2) {
  const result = await query(
    `
    SELECT id, title, created_at
    FROM chat_sessions
    WHERE $1::text = 'local' OR user_id = $1
    ORDER BY created_at DESC
    LIMIT 40
    `,
    [userId(event)],
  );
  return { sessions: result.rows };
}

async function getSession(event: APIGatewayProxyEventV2, sessionId: string) {
  const result = await query(
    `
    SELECT id, role, content, sources, model, prompt_tokens, completion_tokens, created_at
    FROM chat_history
    WHERE session_id = $1
    ORDER BY created_at
    `,
    [sessionId],
  );
  return { sessionId, messages: result.rows };
}

async function handleChat(event: APIGatewayProxyEventV2, responseStream: NodeJS.WritableStream) {
  const body = parseBody(event);
  const question = String(body.message || body.question || "").trim();
  if (!question) {
    writeJson(responseStream, 400, { error: "message is required" });
    return;
  }
  const uid = userId(event);
  const model = String(body.model || header(event, "x-model") || "openai/gpt-4o-mini");
  const provider = String(body.provider || header(event, "x-provider") || "openrouter");
  const apiKey = String(body.apiKey || header(event, "x-api-key") || "");
  let sessionId = String(body.sessionId || "");
  if (!sessionId) {
    const created = await query<{ id: string }>(
      `INSERT INTO chat_sessions (user_id, title) VALUES ($1, $2) RETURNING id`,
      [uid, question.slice(0, 80)],
    );
    sessionId = created.rows[0].id;
  }

  const historyResult = await query<{ role: string; content: string }>(
    `SELECT role, content FROM chat_history WHERE session_id = $1 ORDER BY created_at`,
    [sessionId],
  );
  const sources = await searchChunks(uid, question, model);
  const messages = buildRagMessages(question, sources, historyResult.rows);

  await query(
    `INSERT INTO chat_history (session_id, user_id, role, content, model) VALUES ($1, $2, 'user', $3, $4)`,
    [sessionId, uid, question, model],
  );

  const stream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      ...corsHeaders(),
    },
  });
  const send = (payload: unknown) => {
    stream.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  send({ type: "session", sessionId, sources });

  let answer = "";
  let usage: { prompt_tokens?: number; completion_tokens?: number } = {};
  try {
    for await (const chunk of streamChat({ apiKey, provider, model, messages, stream: true })) {
      if (chunk.type === "token" && chunk.text) {
        answer += chunk.text;
        send({ type: "token", text: chunk.text });
      }
      if (chunk.type === "done" && chunk.usage) {
        usage = chunk.usage;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "LLM error";
    send({ type: "error", error: message });
    stream.end();
    return;
  }

  await query(
    `
    INSERT INTO chat_history
      (session_id, user_id, role, content, sources, model, prompt_tokens, completion_tokens)
    VALUES ($1, $2, 'assistant', $3, $4::jsonb, $5, $6, $7)
    `,
    [
      sessionId,
      uid,
      answer,
      JSON.stringify(sources),
      model,
      usage.prompt_tokens ?? null,
      usage.completion_tokens ?? null,
    ],
  );
  send({ type: "done", sessionId, usage });
  stream.write("data: [DONE]\n\n");
  stream.end();
}
