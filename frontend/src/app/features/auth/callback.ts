import { Component, inject, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";

@Component({
  selector: "app-auth-callback",
  imports: [RouterLink],
  template: `
    <div class="flex min-h-dvh items-center justify-center bg-slate-950 px-6 text-slate-100">
      <div class="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center">
        @if (error()) {
          <h1 class="text-lg font-semibold">Sign-in failed</h1>
          <p class="mt-2 text-sm text-rose-300">{{ error() }}</p>
          <a class="mt-6 inline-block rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950" routerLink="/">Back to home</a>
        } @else {
          <div class="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-400"></div>
          <h1 class="text-lg font-semibold">Signing you in…</h1>
          <p class="mt-2 text-sm text-slate-400">Finishing the secure handshake with your identity provider.</p>
        }
      </div>
    </div>
  `,
})
export class AuthCallback {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly error = signal("");

  constructor() {
    void this.finish();
  }

  private async finish(): Promise<void> {
    try {
      const returnTo = await this.auth.completeLogin();
      await this.router.navigateByUrl(returnTo.startsWith("/") ? returnTo : "/app");
    } catch (err) {
      const params = new URLSearchParams(window.location.search);
      this.error.set(params.get("error_description") || (err instanceof Error ? err.message : "Unexpected error"));
    }
  }
}
