import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { HttpError } from "./auth.js";

const secrets = new SecretsManagerClient({});
const PROVIDERS = new Set(["openrouter", "openai", "anthropic", "gemini", "grok"]);

type KeyMap = Record<string, string>;

const cache = new Map<string, { value: KeyMap; expires: number }>();
const CACHE_MS = 60_000;

function secretName(sub: string): string {
  return `${process.env.USER_SECRET_PREFIX || "easyrag/users"}/${sub}/llm-keys`;
}

export function assertProvider(provider: string): void {
  if (!PROVIDERS.has(provider)) {
    throw new HttpError(400, `Unknown provider: ${provider}`);
  }
}

export async function readKeys(sub: string): Promise<KeyMap> {
  const cached = cache.get(sub);
  if (cached && cached.expires > Date.now()) {
    return cached.value;
  }
  try {
    const response = await secrets.send(new GetSecretValueCommand({ SecretId: secretName(sub) }));
    const value = JSON.parse(response.SecretString || "{}") as KeyMap;
    cache.set(sub, { value, expires: Date.now() + CACHE_MS });
    return value;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      cache.set(sub, { value: {}, expires: Date.now() + CACHE_MS });
      return {};
    }
    throw error;
  }
}

async function writeKeys(sub: string, value: KeyMap): Promise<void> {
  const name = secretName(sub);
  const SecretString = JSON.stringify(value);
  try {
    await secrets.send(new PutSecretValueCommand({ SecretId: name, SecretString }));
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }
    await secrets.send(
      new CreateSecretCommand({
        Name: name,
        SecretString,
        Description: "contextinject BYOK LLM provider keys",
        Tags: [{ Key: "contextinject:user", Value: sub }],
      }),
    );
  }
  cache.set(sub, { value, expires: Date.now() + CACHE_MS });
}

export async function setKey(sub: string, provider: string, apiKey: string): Promise<void> {
  assertProvider(provider);
  const trimmed = apiKey.trim();
  if (trimmed.length < 8) {
    throw new HttpError(400, "API key looks too short");
  }
  const current = await readKeys(sub);
  await writeKeys(sub, { ...current, [provider]: trimmed });
}

export async function deleteKey(sub: string, provider: string): Promise<void> {
  assertProvider(provider);
  const current = await readKeys(sub);
  if (!(provider in current)) {
    return;
  }
  const { [provider]: _removed, ...rest } = current;
  await writeKeys(sub, rest);
}

export async function deleteAllKeys(sub: string): Promise<void> {
  try {
    await secrets.send(new DeleteSecretCommand({ SecretId: secretName(sub), ForceDeleteWithoutRecovery: true }));
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }
  }
  cache.delete(sub);
}

export function maskKey(value: string): string {
  return value.length <= 8 ? "••••" : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export async function listKeys(sub: string): Promise<{ provider: string; masked: string }[]> {
  const keys = await readKeys(sub);
  return Object.entries(keys).map(([provider, value]) => ({ provider, masked: maskKey(value) }));
}
