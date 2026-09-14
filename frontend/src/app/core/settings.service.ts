import { Injectable, computed, signal } from "@angular/core";

export interface AppSettings {
  provider: string;
  model: string;
  darkMode: boolean;
}

const STORAGE_KEY = "contextinject.settings";
const LEGACY_STORAGE_KEY = "easyrag.settings";

const DEFAULTS: AppSettings = {
  provider: "openrouter",
  model: "openai/gpt-5.6-luna",
  darkMode: true,
};

/** Retired or removed IDs remapped so saved Settings keep working. */
const RETIRED_MODEL_ALIASES: Record<string, string> = {
  "claude-sonnet-4-20250514": "claude-sonnet-5",
  "claude-opus-4-20250514": "claude-opus-5",
  "claude-opus-4-1-20250805": "claude-opus-5",
  "claude-3-5-sonnet-latest": "claude-sonnet-5",
  "claude-3-5-haiku-latest": "claude-haiku-4-5",
  "claude-sonnet-4": "claude-sonnet-5",
  "anthropic/claude-3.5-sonnet": "anthropic/claude-sonnet-5",
  "anthropic/claude-sonnet-4": "anthropic/claude-sonnet-5",
  "anthropic/claude-3-haiku": "anthropic/claude-haiku-4.5",
  "google/gemini-2.0-flash-001": "google/gemini-3.8-flash",
  "gemini-2.0-flash": "gemini-3.8-flash",
  "x-ai/grok-2": "x-ai/grok-4.6",
  "x-ai/grok-3-beta": "x-ai/grok-4.6",
  "grok-2": "grok-4.6",
  "grok-3": "grok-4.6",
};

export function resolveStoredModel(model: string): string {
  return RETIRED_MODEL_ALIASES[model] ?? model;
}

@Injectable({ providedIn: "root" })
export class SettingsService {
  private readonly state = signal<AppSettings>(this.read());

  readonly settings = this.state.asReadonly();
  readonly darkMode = computed(() => this.state().darkMode);

  constructor() {
    this.applyTheme(this.state().darkMode);
  }

  update(patch: Partial<AppSettings>): void {
    const next = { ...this.state(), ...patch };
    this.state.set(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    this.applyTheme(next.darkMode);
  }

  private read(): AppSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
      const stored = raw ? (JSON.parse(raw) as Partial<AppSettings> & { apiKey?: string; userId?: string }) : {};
      // Keys used to live in localStorage; they are server-side now.
      const { apiKey: _legacyKey, userId: _legacyUser, ...rest } = stored;
      const parsed: AppSettings = { ...DEFAULTS, ...rest };
      const model = resolveStoredModel(parsed.model);
      const next = { ...parsed, model };
      if (raw !== JSON.stringify(next)) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    } catch {
      return DEFAULTS;
    }
  }

  private applyTheme(dark: boolean): void {
    document.documentElement.classList.toggle("dark", dark);
  }
}

export type ProviderId = "openrouter" | "openai" | "anthropic" | "gemini" | "grok";

export interface ProviderOption {
  id: ProviderId;
  label: string;
  hint: string;
  keysUrl: string;
}

export const PROVIDERS: ProviderOption[] = [
  { id: "openrouter", label: "OpenRouter", hint: "One key for every model below (sk-or-...)", keysUrl: "https://openrouter.ai/keys" },
  { id: "openai", label: "OpenAI", hint: "Direct access to GPT models", keysUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", label: "Anthropic", hint: "Direct access to Claude models", keysUrl: "https://console.anthropic.com/settings/keys" },
  { id: "gemini", label: "Google Gemini", hint: "Direct access to Gemini models", keysUrl: "https://aistudio.google.com/apikey" },
  { id: "grok", label: "xAI Grok", hint: "Direct access to Grok models", keysUrl: "https://console.x.ai" },
];

export interface ModelOption {
  id: string;
  label: string;
  provider: ProviderId;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { provider: "openrouter", id: "openai/gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { provider: "openrouter", id: "openai/gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { provider: "openrouter", id: "openai/gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { provider: "openrouter", id: "openai/gpt-6-astra", label: "GPT-6 Astra" },
  { provider: "openrouter", id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5" },
  { provider: "openrouter", id: "anthropic/claude-opus-5", label: "Claude Opus 5" },
  { provider: "openrouter", id: "anthropic/claude-fable-5.1", label: "Claude Fable 5.1" },
  { provider: "openrouter", id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
  { provider: "openrouter", id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { provider: "openrouter", id: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { provider: "openrouter", id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { provider: "openrouter", id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { provider: "openrouter", id: "x-ai/grok-4.6", label: "Grok 4.6" },
  { provider: "openrouter", id: "x-ai/grok-4.5", label: "Grok 4.5" },
  { provider: "openrouter", id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick" },
  { provider: "openrouter", id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { provider: "openrouter", id: "qwen/qwen3.8-flash", label: "Qwen 3.8 Flash" },
  { provider: "openrouter", id: "mistralai/mistral-large-2512", label: "Mistral Large 2512" },
  { provider: "openai", id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { provider: "openai", id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { provider: "openai", id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { provider: "openai", id: "gpt-6-astra", label: "GPT-6 Astra" },
  { provider: "anthropic", id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { provider: "anthropic", id: "claude-opus-5", label: "Claude Opus 5" },
  { provider: "anthropic", id: "claude-fable-5-1", label: "Claude Fable 5.1" },
  { provider: "anthropic", id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { provider: "anthropic", id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { provider: "gemini", id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { provider: "gemini", id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
  { provider: "gemini", id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { provider: "gemini", id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { provider: "gemini", id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { provider: "grok", id: "grok-4.6", label: "Grok 4.6" },
  { provider: "grok", id: "grok-4.5", label: "Grok 4.5" },
  { provider: "grok", id: "grok-4.3", label: "Grok 4.3" },
];

export function modelsForProvider(provider: string): ModelOption[] {
  return MODEL_OPTIONS.filter((item) => item.provider === provider);
}
