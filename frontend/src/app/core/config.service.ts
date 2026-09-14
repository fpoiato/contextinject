import { Injectable, signal } from "@angular/core";
import { environment } from "./environment";

export interface PlanInfo {
  id: string;
  name: string;
  priceUsd: number;
  storageBytes: number;
  maxUploadBytes: number;
}

export interface AppConfig {
  region: string;
  userPoolId: string;
  clientId: string;
  domain: string;
  plans: PlanInfo[];
}

const GB = 1024 ** 3;

export const FALLBACK_PLANS: PlanInfo[] = [
  { id: "starter", name: "Starter", priceUsd: 10, storageBytes: 1 * GB, maxUploadBytes: 100 * 1024 ** 2 },
  { id: "pro", name: "Pro", priceUsd: 50, storageBytes: 50 * GB, maxUploadBytes: 500 * 1024 ** 2 },
  { id: "business", name: "Business", priceUsd: 100, storageBytes: 200 * GB, maxUploadBytes: 2 * GB },
];

@Injectable({ providedIn: "root" })
export class ConfigService {
  private readonly state = signal<AppConfig | null>(null);
  readonly config = this.state.asReadonly();
  readonly loadError = signal("");

  async load(): Promise<void> {
    try {
      const response = await fetch(`${environment.apiUrl}/config`);
      if (!response.ok) {
        throw new Error(`config ${response.status}`);
      }
      const data = (await response.json()) as AppConfig;
      this.state.set({ ...data, plans: data.plans?.length ? data.plans : FALLBACK_PLANS });
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : "Could not load configuration");
      this.state.set(null);
    }
  }

  get plans(): PlanInfo[] {
    return this.state()?.plans ?? FALLBACK_PLANS;
  }

  require(): AppConfig {
    const current = this.state();
    if (!current) {
      throw new Error("Configuration is unavailable. Try again in a moment.");
    }
    return current;
  }
}
