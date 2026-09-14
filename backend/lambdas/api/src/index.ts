import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { authenticate, HttpError, requireAdmin, type AuthContext } from "./auth.js";
import { DatabaseUnavailableError, query } from "./db.js";
import { deleteKey, listKeys, readKeys, setKey } from "./keys.js";
import { providerOf, streamChat } from "./llm.js";
import { PLANS, planFor } from "./plans.js";
import { dbStatus, startDb, stopDb } from "./rds-admin.js";
import { buildRagMessages, searchChunks } from "./rag.js";
import {
  completeUpload,
  createFolder,
  createProject,
  deleteDocument,
  deleteFolder,
  deleteProject,
  deleteSession,
  getSession,
  listProjects,
  listSessions,
  presignUpload,
  projectTree,
  renameProject,
  updateDocument,
  updateFolder,
  usageFor,
} from "./workspace.js";

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

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://contextinject.fpoiato.com";

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": ALLOWED_ORIGIN,
    "access-control-allow-headers": "content-type,authorization",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  };
}

function writeJson(stream: NodeJS.WritableStream, statusCode: number, body: unknown): void {
  const out = awslambda.HttpResponseStream.from(stream, {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
  });
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
    throw new HttpError(400, "Invalid JSON body");
  }
}

type Params = Record<string, string>;

function match(pattern: string, path: string): Params | null {
  const patternParts = pattern.split("/");
  const pathParts = path.split("/");
  if (patternParts.length !== pathParts.length) {
    return null;
  }
  const params: Params = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i];
    const actual = pathParts[i];
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidParam(value: string | undefined, name: string): string {
  if (!value || !UUID_RE.test(value)) {
    throw new HttpError(400, `${name} must be a UUID`);
  }
  return value;
}

function optionalUuid(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return uuidParam(String(value), name);
}

const seenUsers = new Set<string>();

async function ensureUser(auth: AuthContext): Promise<void> {
  if (seenUsers.has(auth.sub)) {
    return;
  }
  await query(
    `
    INSERT INTO users (id, email) VALUES ($1, $2)
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = now()
    `,
    [auth.sub, auth.email],
  );
  seenUsers.add(auth.sub);
}

async function me(auth: AuthContext) {
  await ensureUser(auth);
  const row = await query<{ plan: string; email: string; settings: Record<string, unknown>; created_at: string }>(
    `SELECT plan, email, settings, created_at FROM users WHERE id = $1`,
    [auth.sub],
  );
  const user = row.rows[0];
  const plan = planFor(user?.plan);
  const [usage, keys] = await Promise.all([usageFor(auth.sub), listKeys(auth.sub)]);
  return {
    sub: auth.sub,
    email: user?.email ?? auth.email,
    isAdmin: auth.groups.includes("admin"),
    plan: { id: plan.id, name: plan.name, priceUsd: plan.priceUsd, storageBytes: plan.storageBytes, maxUploadBytes: plan.maxUploadBytes },
    usage,
    keys,
    settings: user?.settings ?? {},
    createdAt: user?.created_at,
  };
}

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const method = event.requestContext.http.method.toUpperCase();
  const path = (event.rawPath || "/").replace(/\/+$/, "") || "/";
  const qs = event.queryStringParameters ?? {};

  if (method === "OPTIONS") {
    writeJson(responseStream, 204, {});
    return;
  }

  try {
    if (method === "GET" && path === "/health") {
      writeJson(responseStream, 200, { ok: true, service: "contextinject" });
      return;
    }
    if (method === "GET" && path === "/config") {
      writeJson(responseStream, 200, {
        region: process.env.AWS_REGION,
        userPoolId: process.env.COGNITO_USER_POOL_ID,
        clientId: process.env.COGNITO_CLIENT_ID,
        domain: process.env.COGNITO_DOMAIN,
        plans: Object.values(PLANS),
      });
      return;
    }

    const auth = await authenticate(event);
    let params: Params | null;

    if (method === "GET" && path === "/db") {
      writeJson(responseStream, 200, await dbStatus());
      return;
    }
    if (method === "POST" && path === "/db/start") {
      writeJson(responseStream, 200, await startDb());
      return;
    }
    if (method === "POST" && path === "/db/stop") {
      requireAdmin(auth);
      writeJson(responseStream, 200, await stopDb());
      return;
    }

    if (method === "GET" && path === "/me") {
      writeJson(responseStream, 200, await me(auth));
      return;
    }
    if (method === "PATCH" && path === "/me") {
      await ensureUser(auth);
      const body = parseBody(event);
      const settings = typeof body.settings === "object" && body.settings ? body.settings : {};
      await query(`UPDATE users SET settings = settings || $2::jsonb, updated_at = now() WHERE id = $1`, [
        auth.sub,
        JSON.stringify(settings),
      ]);
      writeJson(responseStream, 200, await me(auth));
      return;
    }
    if (method === "GET" && path === "/me/keys") {
      writeJson(responseStream, 200, { keys: await listKeys(auth.sub) });
      return;
    }
    if ((params = match("/me/keys/:provider", path)) && method === "PUT") {
      const body = parseBody(event);
      await setKey(auth.sub, params.provider, String(body.apiKey ?? ""));
      writeJson(responseStream, 200, { keys: await listKeys(auth.sub) });
      return;
    }
    if ((params = match("/me/keys/:provider", path)) && method === "DELETE") {
      await deleteKey(auth.sub, params.provider);
      writeJson(responseStream, 200, { keys: await listKeys(auth.sub) });
      return;
    }

    await ensureUser(auth);

    if (method === "GET" && path === "/projects") {
      writeJson(responseStream, 200, { projects: await listProjects(auth.sub) });
      return;
    }
    if (method === "POST" && path === "/projects") {
      const body = parseBody(event);
      writeJson(responseStream, 201, await createProject(auth.sub, String(body.name ?? "")));
      return;
    }
    if ((params = match("/projects/:id", path)) && method === "PATCH") {
      const body = parseBody(event);
      writeJson(responseStream, 200, await renameProject(auth.sub, uuidParam(params.id, "project id"), String(body.name ?? "")));
      return;
    }
    if ((params = match("/projects/:id", path)) && method === "DELETE") {
      await deleteProject(auth.sub, uuidParam(params.id, "project id"));
      writeJson(responseStream, 200, { ok: true });
      return;
    }
    if ((params = match("/projects/:id/tree", path)) && method === "GET") {
      writeJson(responseStream, 200, await projectTree(auth.sub, uuidParam(params.id, "project id")));
      return;
    }
    if ((params = match("/projects/:id/folders", path)) && method === "POST") {
      const body = parseBody(event);
      writeJson(
        responseStream,
        201,
        await createFolder(auth.sub, uuidParam(params.id, "project id"), String(body.name ?? ""), optionalUuid(body.parentId, "parentId")),
      );
      return;
    }
    if ((params = match("/folders/:id", path)) && method === "PATCH") {
      const body = parseBody(event);
      writeJson(
        responseStream,
        200,
        await updateFolder(auth.sub, uuidParam(params.id, "folder id"), {
          name: body.name === undefined ? undefined : String(body.name),
          parentId: body.parentId === undefined ? undefined : optionalUuid(body.parentId, "parentId"),
        }),
      );
      return;
    }
    if ((params = match("/folders/:id", path)) && method === "DELETE") {
      await deleteFolder(auth.sub, uuidParam(params.id, "folder id"));
      writeJson(responseStream, 200, { ok: true });
      return;
    }
    if ((params = match("/projects/:id/uploads/presign", path)) && method === "POST") {
      const body = parseBody(event);
      writeJson(
        responseStream,
        200,
        await presignUpload(auth.sub, uuidParam(params.id, "project id"), {
          filename: String(body.filename ?? ""),
          contentType: String(body.contentType ?? "application/octet-stream"),
          size: Number(body.size ?? 0),
          folderId: optionalUuid(body.folderId, "folderId"),
        }),
      );
      return;
    }
    if (method === "POST" && path === "/uploads/complete") {
      const body = parseBody(event);
      writeJson(responseStream, 202, await completeUpload(auth.sub, uuidParam(String(body.documentId ?? ""), "documentId")));
      return;
    }
    if ((params = match("/documents/:id", path)) && method === "PATCH") {
      const body = parseBody(event);
      writeJson(
        responseStream,
        200,
        await updateDocument(auth.sub, uuidParam(params.id, "document id"), {
          filename: body.filename === undefined ? undefined : String(body.filename),
          folderId: body.folderId === undefined ? undefined : optionalUuid(body.folderId, "folderId"),
        }),
      );
      return;
    }
    if ((params = match("/documents/:id", path)) && method === "DELETE") {
      await deleteDocument(auth.sub, uuidParam(params.id, "document id"));
      writeJson(responseStream, 200, { ok: true });
      return;
    }
    if ((params = match("/projects/:id/sessions", path)) && method === "GET") {
      writeJson(responseStream, 200, { sessions: await listSessions(auth.sub, uuidParam(params.id, "project id")) });
      return;
    }
    if ((params = match("/sessions/:id", path)) && method === "GET") {
      writeJson(responseStream, 200, await getSession(auth.sub, uuidParam(params.id, "session id")));
      return;
    }
    if ((params = match("/sessions/:id", path)) && method === "DELETE") {
      await deleteSession(auth.sub, uuidParam(params.id, "session id"));
      writeJson(responseStream, 200, { ok: true });
      return;
    }
    if (method === "POST" && path === "/chat") {
      await handleChat(auth, event, responseStream);
      return;
    }
    void qs;
    writeJson(responseStream, 404, { error: "Not found" });
  } catch (error) {
    if (error instanceof HttpError) {
      writeJson(responseStream, error.status, { error: error.message, code: error.code });
      return;
    }
    if (error instanceof DatabaseUnavailableError) {
      writeJson(responseStream, 503, { error: error.message, code: "DB_STOPPED", stopped: error.stopped });
      return;
    }
    console.error(error);
    const message = error instanceof Error ? error.message : "Internal error";
    writeJson(responseStream, 500, { error: message });
  }
});

async function handleChat(auth: AuthContext, event: APIGatewayProxyEventV2, responseStream: NodeJS.WritableStream) {
  const body = parseBody(event);
  const question = String(body.message || body.question || "").trim();
  if (!question) {
    throw new HttpError(400, "message is required");
  }
  const projectId = uuidParam(String(body.projectId ?? ""), "projectId");
  const folderId = optionalUuid(body.folderId, "folderId");
  const owned = await query<{ id: string }>(`SELECT id FROM projects WHERE id = $1 AND user_id = $2`, [projectId, auth.sub]);
  if (owned.rowCount === 0) {
    throw new HttpError(404, "Project not found");
  }

  const model = String(body.model || "openai/gpt-5.6-luna");
  const provider = providerOf(model, body.provider ? String(body.provider) : undefined);
  const keys = await readKeys(auth.sub);
  const apiKey = keys[provider] ?? (provider !== "openrouter" ? keys.openrouter : undefined);
  const effectiveProvider = keys[provider] ? provider : apiKey ? "openrouter" : provider;
  if (!apiKey) {
    throw new HttpError(
      402,
      `No API key configured for ${provider}. Add your key in Account → API keys.`,
      "NO_API_KEY",
    );
  }

  let sessionId = optionalUuid(body.sessionId, "sessionId");
  if (sessionId) {
    const session = await query<{ id: string }>(
      `SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2 AND project_id = $3`,
      [sessionId, auth.sub, projectId],
    );
    if (session.rowCount === 0) {
      throw new HttpError(404, "Session not found");
    }
  } else {
    const created = await query<{ id: string }>(
      `INSERT INTO chat_sessions (user_id, project_id, title) VALUES ($1, $2, $3) RETURNING id`,
      [auth.sub, projectId, question.slice(0, 80)],
    );
    sessionId = created.rows[0].id;
  }

  const historyResult = await query<{ role: string; content: string }>(
    `SELECT role, content FROM chat_history WHERE session_id = $1 ORDER BY created_at`,
    [sessionId],
  );
  const sources = await searchChunks({ userId: auth.sub, projectId, folderId }, question, model);
  const messages = buildRagMessages(question, sources, historyResult.rows);

  await query(
    `INSERT INTO chat_history (session_id, user_id, role, content, model) VALUES ($1, $2, 'user', $3, $4)`,
    [sessionId, auth.sub, question, model],
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
    for await (const chunk of streamChat({ apiKey, provider: effectiveProvider, model, messages, stream: true })) {
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
    [sessionId, auth.sub, answer, JSON.stringify(sources), model, usage.prompt_tokens ?? null, usage.completion_tokens ?? null],
  );
  send({ type: "done", sessionId, usage });
  stream.write("data: [DONE]\n\n");
  stream.end();
}
