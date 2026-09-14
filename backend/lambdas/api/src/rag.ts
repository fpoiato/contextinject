import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { query, toSqlVector } from "./db.js";

const lambda = new LambdaClient({});

export interface RetrievedChunk {
  id: string;
  content: string;
  page: number | null;
  filename: string;
  score: number;
}

const MODEL_WINDOWS: Record<string, number> = {
  "openai/gpt-4o-mini": 128000,
  "openai/gpt-4o": 128000,
  "anthropic/claude-sonnet-4": 200000,
  "anthropic/claude-3.5-sonnet": 200000,
  "google/gemini-2.0-flash-001": 1000000,
  "google/gemini-flash-1.5": 1000000,
  "x-ai/grok-2": 131072,
  "x-ai/grok-beta": 131072,
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

export async function searchChunks(userId: string, queryText: string, model: string): Promise<RetrievedChunk[]> {
  const vector = await embedQuery(queryText);
  const limit = retrievalLimit(model);
  const result = await query<{
    id: string;
    content: string;
    page: number | null;
    filename: string;
    score: number;
  }>(
    `
    SELECT
      c.id,
      c.content,
      c.page,
      d.filename,
      (1 - (c.embedding <=> $1::vector)) AS score
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.embedding IS NOT NULL
      AND d.status = 'ready'
      AND ($2::text = 'local' OR c.user_id = $2)
    ORDER BY c.embedding <=> $1::vector
    LIMIT $3
    `,
    [toSqlVector(vector), userId, limit],
  );
  return result.rows.map((row) => ({
    ...row,
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
