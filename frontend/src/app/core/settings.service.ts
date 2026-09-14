import { Injectable, computed, signal } from "@angular/core";

export interface AppSettings {
  apiKey: string;
  provider: string;
  model: string;
  userId: string;
  darkMode: boolean;
}

const STORAGE_KEY = "easyrag.settings";

const DEFAULTS: AppSettings = {
  apiKey: "",
  provider: "openrouter",
  model: "openai/gpt-4o-mini",
  userId: "local",
  darkMode: true,
};

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
    this.applyTheme(next.darkMode);
  }

  private read(): AppSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as AppSettings) } : DEFAULTS;
    } catch {
      return DEFAULTS;
    }
  }

  private applyTheme(dark: boolean): void {
    document.documentElement.classList.toggle("dark", dark);
  }
}

export interface ModelOption {
  id: string;
  label: string;
  provider: "openrouter" | "openai" | "anthropic" | "gemini" | "grok";
}

export const MODEL_OPTIONS: ModelOption[] = [
  { provider: "openrouter", id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
  { provider: "openrouter", id: "openai/gpt-4o", label: "GPT-4o" },
  { provider: "openrouter", id: "openai/gpt-4.1-mini", label: "GPT-4.1 mini" },
  { provider: "openrouter", id: "openai/gpt-4.1", label: "GPT-4.1" },
  { provider: "openrouter", id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
  { provider: "openrouter", id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
  { provider: "openrouter", id: "anthropic/claude-3-haiku", label: "Claude 3 Haiku" },
  { provider: "openrouter", id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash" },
  { provider: "openrouter", id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { provider: "openrouter", id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { provider: "openrouter", id: "x-ai/grok-2", label: "Grok 2" },
  { provider: "openrouter", id: "x-ai/grok-3-beta", label: "Grok 3" },
  { provider: "openrouter", id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
  { provider: "openrouter", id: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
  { provider: "openrouter", id: "qwen/qwen-2.5-72b-instruct", label: "Qwen 2.5 72B" },
  { provider: "openrouter", id: "mistralai/mistral-large", label: "Mistral Large" },
  { provider: "openai", id: "gpt-4o-mini", label: "GPT-4o mini" },
  { provider: "openai", id: "gpt-4o", label: "GPT-4o" },
  { provider: "openai", id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  { provider: "openai", id: "gpt-4.1", label: "GPT-4.1" },
  { provider: "anthropic", id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { provider: "anthropic", id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" },
  { provider: "anthropic", id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku" },
  { provider: "gemini", id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { provider: "gemini", id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { provider: "gemini", id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { provider: "grok", id: "grok-2", label: "Grok 2" },
  { provider: "grok", id: "grok-3", label: "Grok 3" },
];

export function modelsForProvider(provider: string): ModelOption[] {
  return MODEL_OPTIONS.filter((item) => item.provider === provider);
}
