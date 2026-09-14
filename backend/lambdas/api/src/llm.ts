export interface ChatRequest {
  apiKey?: string;
  provider?: string;
  model: string;
  messages: { role: string; content: string }[];
  stream?: boolean;
}

export interface ChatChunk {
  type: "token" | "done";
  text?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function providerOf(model: string, explicit?: string): string {
  if (explicit && explicit !== "auto") {
    return explicit;
  }
  if (model.startsWith("anthropic/")) return "anthropic";
  if (model.startsWith("google/") || model.startsWith("gemini")) return "gemini";
  if (model.startsWith("x-ai/") || model.startsWith("grok")) return "grok";
  if (model.startsWith("openai/") || model.startsWith("gpt")) return "openai";
  return "openrouter";
}

function headersFor(provider: string, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = process.env.ALLOWED_ORIGIN || "https://easyrag.fpoiato.com";
    headers["X-Title"] = "easyRAG";
  }
  if (provider === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    delete headers.Authorization;
  }
  return headers;
}

function endpointFor(provider: string, apiKey: string): string {
  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1/chat/completions";
    case "grok":
      return "https://api.x.ai/v1/chat/completions";
    case "gemini":
      return `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`;
    case "anthropic":
      return "https://api.anthropic.com/v1/messages";
    default:
      return "https://openrouter.ai/api/v1/chat/completions";
  }
}

function modelName(model: string, provider: string): string {
  if (provider === "openrouter") {
    return model;
  }
  const parts = model.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : model;
}

export async function* streamChat(request: ChatRequest): AsyncGenerator<ChatChunk> {
  const apiKey = request.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing API key. Add one in Settings.");
  }
  const provider = providerOf(request.model, request.provider);
  const model = modelName(request.model, provider);
  const url = endpointFor(provider, apiKey);

  if (provider === "anthropic") {
    yield* streamAnthropic(url, apiKey, model, request.messages);
    return;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: headersFor(provider, apiKey),
    body: JSON.stringify({
      model,
      stream: true,
      messages: request.messages,
    }),
  });
  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${detail.slice(0, 800)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: ChatChunk["usage"];
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") {
        continue;
      }
      try {
        const parsed = JSON.parse(data) as {
          choices?: { delta?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) {
          yield { type: "token", text: token };
        }
        if (parsed.usage) {
          usage = parsed.usage;
        }
      } catch {
        continue;
      }
    }
  }
  yield { type: "done", usage };
}

async function* streamAnthropic(
  url: string,
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
): AsyncGenerator<ChatChunk> {
  const system = messages.filter((item) => item.role === "system").map((item) => item.content).join("\n\n");
  const rest = messages.filter((item) => item.role !== "system");
  const response = await fetch(url, {
    method: "POST",
    headers: headersFor("anthropic", apiKey),
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      stream: true,
      system,
      messages: rest,
    }),
  });
  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(`Anthropic request failed (${response.status}): ${detail.slice(0, 800)}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: ChatChunk["usage"] = {};
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      try {
        const parsed = JSON.parse(data) as {
          type?: string;
          delta?: { text?: string };
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        if (parsed.type === "content_block_delta" && parsed.delta?.text) {
          yield { type: "token", text: parsed.delta.text };
        }
        if (parsed.usage) {
          usage = {
            prompt_tokens: parsed.usage.input_tokens,
            completion_tokens: parsed.usage.output_tokens,
          };
        }
      } catch {
        continue;
      }
    }
  }
  yield { type: "done", usage };
}
