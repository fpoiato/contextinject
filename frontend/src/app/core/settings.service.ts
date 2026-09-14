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

export const MODEL_OPTIONS = [
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
  { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
  { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash" },
  { id: "x-ai/grok-2", label: "Grok 2" },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
];
