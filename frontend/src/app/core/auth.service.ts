import { Injectable, computed, inject, signal } from "@angular/core";
import { OidcClient, User, UserManager, WebStorageStateStore } from "oidc-client-ts";
import { ConfigService } from "./config.service";

const RETURN_KEY = "easyrag.returnTo";

@Injectable({ providedIn: "root" })
export class AuthService {
  private readonly config = inject(ConfigService);
  private manager: UserManager | null = null;
  private readonly userState = signal<User | null>(null);
  private ready: Promise<void> | null = null;

  readonly user = this.userState.asReadonly();
  readonly isAuthenticated = computed(() => {
    const current = this.userState();
    return !!current && !current.expired;
  });
  readonly email = computed(() => String(this.userState()?.profile?.email ?? ""));
  readonly isAdmin = computed(() => {
    const groups = this.userState()?.profile?.["cognito:groups"];
    return Array.isArray(groups) && groups.includes("admin");
  });

  private getManager(): UserManager {
    if (this.manager) {
      return this.manager;
    }
    const cfg = this.config.require();
    const origin = window.location.origin;
    this.manager = new UserManager({
      authority: `https://cognito-idp.${cfg.region}.amazonaws.com/${cfg.userPoolId}`,
      client_id: cfg.clientId,
      redirect_uri: `${origin}/auth/callback`,
      post_logout_redirect_uri: `${origin}/`,
      response_type: "code",
      scope: "openid email profile",
      loadUserInfo: false,
      automaticSilentRenew: true,
      userStore: new WebStorageStateStore({ store: window.localStorage }),
      metadataSeed: { end_session_endpoint: `${cfg.domain}/logout` },
    });
    this.manager.events.addUserLoaded((user) => this.userState.set(user));
    this.manager.events.addUserUnloaded(() => this.userState.set(null));
    this.manager.events.addAccessTokenExpired(() => {
      void this.manager?.signinSilent().catch(() => this.userState.set(null));
    });
    return this.manager;
  }

  /** Restores a persisted session; safe to call many times. */
  restore(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        try {
          const user = await this.getManager().getUser();
          if (user && user.expired && user.refresh_token) {
            const renewed = await this.getManager().signinSilent().catch(() => null);
            this.userState.set(renewed);
          } else {
            this.userState.set(user);
          }
        } catch {
          this.userState.set(null);
        }
      })();
    }
    return this.ready;
  }

  async login(returnTo = "/app"): Promise<void> {
    sessionStorage.setItem(RETURN_KEY, returnTo);
    await this.getManager().signinRedirect();
  }

  async signup(returnTo = "/app"): Promise<void> {
    sessionStorage.setItem(RETURN_KEY, returnTo);
    const cfg = this.config.require();
    const manager = this.getManager();
    // Cognito Managed Login exposes sign-up as a separate endpoint; reuse the OIDC state so the callback still works.
    const request = await new OidcClient(manager.settings).createSigninRequest({ request_type: "si:r" });
    const url = new URL(request.url);
    const target = new URL(`${cfg.domain}/signup`);
    url.searchParams.forEach((value, key) => target.searchParams.set(key, value));
    window.location.assign(target.toString());
  }

  async completeLogin(): Promise<string> {
    const user = await this.getManager().signinCallback();
    if (user) {
      this.userState.set(user);
    }
    const returnTo = sessionStorage.getItem(RETURN_KEY) || "/app";
    sessionStorage.removeItem(RETURN_KEY);
    return returnTo;
  }

  async logout(): Promise<void> {
    const cfg = this.config.require();
    const manager = this.getManager();
    await manager.removeUser();
    this.userState.set(null);
    const logoutUrl = new URL(`${cfg.domain}/logout`);
    logoutUrl.searchParams.set("client_id", cfg.clientId);
    logoutUrl.searchParams.set("logout_uri", `${window.location.origin}/`);
    window.location.assign(logoutUrl.toString());
  }

  async idToken(): Promise<string | null> {
    await this.restore();
    let current = this.userState();
    if (current?.expired) {
      current = await this.getManager().signinSilent().catch(() => null);
      this.userState.set(current);
    }
    return current?.id_token ?? null;
  }
}
