import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { query, toSqlVector } from "./db.js";

const lambda = new LambdaClient({});

export interface RetrievedChunk {
  id: string;
  content: string;
  page: number | null;
  filename: string;
  documentId: string;
  score: number;
}

const MODEL_WINDOWS: Record<string, number> = {
  "openai/gpt-5.6-luna": 400000,
  "openai/gpt-5.6-sol": 400000,
  "openai/gpt-5.6-terra": 400000,
  "anthropic/claude-sonnet-5": 1000000,
  "anthropic/claude-opus-5": 1000000,
  "anthropic/claude-haiku-4.5": 200000,
  "google/gemini-3.8-flash": 1000000,
  "google/gemini-3.5-pro": 1000000,
  "x-ai/grok-4.6": 256000,
  "meta-llama/llama-4-maverick": 1000000,
  "deepseek/deepseek-v4": 128000,
  "qwen/qwen3.5-235b": 128000,
  "mistralai/mistral-large-3": 128000,
};

export function contextLimit(model: string): number {
  const exact = MODEL_WINDOWS[model];
  if (exact) {
    return exact;
  }
  const found = Object.entries(MODEL_WINDOWS).find(([key]) => model.includes(key.split("/")[1] ?? key));
  return found?.[1] ?? 32000;
}

export function retrievalLimit(model: string): number {
  const windowTokens = contextLimit(model);
  const ragBudget = Math.min(6000, Math.max(1200, Math.floor(windowTokens * 0.12)));
  return Math.max(4, Math.min(16, Math.floor(ragBudget / 350)));
}

export async function embedQuery(text: string): Promise<number[]> {
  const response = await lambda.send(
    new InvokeCommand({
      FunctionName: process.env.EMBED_FUNCTION_NAME,
      Payload: Buffer.from(JSON.stringify({ texts: [text], is_query: true })),
    }),
  );
  const payload = JSON.parse(Buffer.from(response.Payload ?? []).toString("utf8")) as {
    embeddings?: number[][];
    errorMessage?: string;
  };
  if (!payload.embeddings?.[0]) {
    throw new Error(payload.errorMessage || "Embedding function returned no vector");
  }
  return payload.embeddings[0];
}

export interface SearchScope {
  userId: string;
  projectId: string;
  folderId?: string | null;
}

export async function searchChunks(scope: SearchScope, queryText: string, model: string): Promise<RetrievedChunk[]> {
  const vector = await embedQuery(queryText);
  const limit = retrievalLimit(model);
  const result = await query<{
    id: string;
    content: string;
    page: number | null;
    filename: string;
    document_id: string;
    score: number;
  }>(
    `
    WITH RECURSIVE scope_folders AS (
      SELECT id FROM folders WHERE id = $4::uuid AND project_id = $3::uuid
      UNION ALL
      SELECT f.id FROM folders f JOIN scope_folders s ON f.parent_id = s.id
    )
    SELECT
      c.id,
      c.content,
      c.page,
      d.filename,
      d.id AS document_id,
      (1 - (c.embedding <=> $1::vector)) AS score
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.embedding IS NOT NULL
      AND d.status = 'ready'
      AND d.user_id = $2
      AND d.project_id = $3::uuid
      AND ($4::uuid IS NULL OR d.folder_id IN (SELECT id FROM scope_folders))
    ORDER BY c.embedding <=> $1::vector
    LIMIT $5
    `,
    [toSqlVector(vector), scope.userId, scope.projectId, scope.folderId ?? null, limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    content: row.content,
    page: row.page,
    filename: row.filename,
    documentId: row.document_id,
    score: Number(row.score),
  }));
}

export function buildRagMessages(
  question: string,
  sources: RetrievedChunk[],
  history: { role: string; content: string }[],
): { role: "system" | "user" | "assistant"; content: string }[] {
  const context = sources
    .map(
      (source, index) =>
        `[#${index + 1}] ${source.filename}${source.page ? ` p.${source.page}` : ""} (score ${source.score.toFixed(3)})\n${source.content}`,
    )
    .join("\n\n");

  const system = [
    "You are easyRAG, a precise assistant that answers using the retrieved document context.",
    "Cite sources as [#n] when you use them. If the context is insufficient, say so clearly.",
    "Reply in the same language as the user question.",
    context ? `Retrieved context:\n${context}` : "No document context was retrieved.",
  ].join("\n\n");

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [{ role: "system", content: system }];
  for (const item of history.slice(-8)) {
    if (item.role === "user" || item.role === "assistant") {
      messages.push({ role: item.role, content: item.content });
    }
  }
  messages.push({ role: "user", content: question });
  return messages;
}
