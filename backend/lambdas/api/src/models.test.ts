import assert from "node:assert/strict";
import { apiKeyForProvider, resolveModelId } from "./models.ts";

assert.equal(resolveModelId("claude-sonnet-4-20250514"), "claude-sonnet-5");
assert.equal(resolveModelId("claude-sonnet-5"), "claude-sonnet-5");
assert.equal(resolveModelId("claude-3-5-sonnet-latest"), "claude-sonnet-5");
assert.equal(resolveModelId("anthropic/claude-sonnet-4"), "anthropic/claude-sonnet-5");
assert.equal(resolveModelId("google/gemini-2.0-flash-001"), "google/gemini-3.8-flash");
assert.equal(resolveModelId("x-ai/grok-2"), "x-ai/grok-4.6");
assert.equal(resolveModelId("grok-3"), "grok-4.6");

const previous = process.env.ANTHROPIC_API_KEY;
process.env.ANTHROPIC_API_KEY = "sk-ant-env";
assert.equal(apiKeyForProvider("anthropic", ""), "sk-ant-env");
assert.equal(apiKeyForProvider("anthropic", "sk-ant-browser"), "sk-ant-browser");
if (previous === undefined) {
  delete process.env.ANTHROPIC_API_KEY;
} else {
  process.env.ANTHROPIC_API_KEY = previous;
}

console.log("models.test.ts ok");
