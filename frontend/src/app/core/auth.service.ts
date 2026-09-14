import { Injectable, computed, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { environment } from "./environment";

const STORAGE_KEY = "contextinject.session";
const LEGACY_STORAGE_KEY = "easyrag.session";

export interface AuthSession {
  idToken: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  sub: string;
  email: string;
  groups: string[];
}

export interface AuthChallenge {
  challenge: "NEW_PASSWORD_REQUIRED";
  session: string;
  email: string;
}

interface AuthApiError {
  error?: string;
  code?: string;
}

interface AuthPayload extends AuthApiError {
  challenge?: string;
  session?: string;
  email?: string;
  idToken?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  sub?: string;
  groups?: unknown;
}

@Injectable({ providedIn: "root" })
export class AuthService {
  private readonly router = inject(Router);
  private readonly sessionState = signal<AuthSession | null>(null);
  private refreshInFlight: Promise<string | null> | null = null;
  private restored = false;

  readonly user = this.sessionState.asReadonly();
  readonly isAuthenticated = computed(() => {
    const current = this.sessionState();
    return !!current && current.expiresAt > Date.now() + 15_000;
  });
  readonly email = computed(() => this.sessionState()?.email ?? "");
  readonly isAdmin = computed(() => this.sessionState()?.groups.includes("admin") ?? false);

  restore(): Promise<void> {
    if (this.restored) {
      return Promise.resolve();
    }
    this.restored = true;
    const stored = this.readStore();
    if (!stored) {
      this.sessionState.set(null);
      return Promise.resolve();
    }
    this.sessionState.set(stored);
    if (stored.expiresAt <= Date.now() + 60_000) {
      return this.idToken().then(() => undefined);
    }
    return Promise.resolve();
  }

  async login(email: string, password: string): Promise<AuthSession | AuthChallenge> {
    const payload = await this.post("/auth/login", { email, password });
    if (payload.challenge === "NEW_PASSWORD_REQUIRED") {
      return {
        challenge: "NEW_PASSWORD_REQUIRED",
        session: String(payload.session ?? ""),
        email: String(payload.email ?? email),
      };
    }
    return this.persist(payload);
  }

  async completeChallenge(email: string, session: string, newPassword: string): Promise<AuthSession> {
    return this.persist(await this.post("/auth/challenge", { email, session, newPassword }));
  }

  async signup(email: string, password: string): Promise<{ email: string }> {
    const payload = await this.post("/auth/signup", { email, password });
    return { email: String(payload.email ?? email) };
  }

  async confirm(email: string, code: string): Promise<void> {
    await this.post("/auth/confirm", { email, code });
  }

  async resend(email: string): Promise<void> {
    await this.post("/auth/resend", { email });
  }

  async forgot(email: string): Promise<void> {
    await this.post("/auth/forgot", { email });
  }

  async resetPassword(email: string, code: string, password: string): Promise<void> {
    await this.post("/auth/reset", { email, code, password });
  }

  async logout(): Promise<void> {
    const current = this.sessionState();
    try {
      await this.post("/auth/logout", {
        refreshToken: current?.refreshToken,
        accessToken: current?.accessToken,
      });
    } catch {
      // local sign-out still proceeds
    }
    this.clear();
    await this.router.navigateByUrl("/");
  }

  async idToken(): Promise<string | null> {
    await this.restore();
    const current = this.sessionState();
    if (!current) {
      return null;
    }
    if (current.expiresAt > Date.now() + 60_000) {
      return current.idToken;
    }
    if (!current.refreshToken) {
      this.clear();
      return null;
    }
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refresh(current.refreshToken).finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  goToLogin(returnTo = "/app"): void {
    const tree = this.router.createUrlTree(["/login"], { queryParams: { returnTo } });
    void this.router.navigateByUrl(tree);
  }

  private async refresh(refreshToken: string): Promise<string | null> {
    try {
      const session = this.persist(await this.post("/auth/refresh", { refreshToken }));
      return session.idToken;
    } catch {
      this.clear();
      return null;
    }
  }

  private persist(payload: AuthPayload): AuthSession {
    const idToken = String(payload.idToken ?? "");
    const accessToken = String(payload.accessToken ?? "");
    if (!idToken || !accessToken) {
      throw new Error("Sign-in did not return a session");
    }
    const expiresIn = Number(payload.expiresIn ?? 3600);
    const session: AuthSession = {
      idToken,
      accessToken,
      refreshToken: payload.refreshToken ? String(payload.refreshToken) : this.sessionState()?.refreshToken ?? null,
      expiresAt: Date.now() + Math.max(expiresIn - 30, 60) * 1000,
      sub: String(payload.sub ?? ""),
      email: String(payload.email ?? ""),
      groups: Array.isArray(payload.groups) ? payload.groups.map(String) : [],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    this.sessionState.set(session);
    return session;
  }

  private clear(): void {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    this.sessionState.set(null);
  }

  private readStore(): AuthSession | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as AuthSession;
      if (!parsed.idToken || !parsed.expiresAt) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private async post(path: string, body: Record<string, unknown>): Promise<AuthPayload> {
    const response = await fetch(`${environment.apiUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    let payload: AuthPayload = {};
    try {
      payload = (await response.json()) as AuthPayload;
    } catch {
      payload = {};
    }
    if (!response.ok) {
      const error = new Error(payload.error || `Request failed (${response.status})`) as Error & { code?: string };
      error.code = payload.code;
      throw error;
    }
    return payload;
  }
}
