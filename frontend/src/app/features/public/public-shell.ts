import { Component, inject, signal } from "@angular/core";
import { RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { ConfigService } from "../../core/config.service";

@Component({
  selector: "app-public-shell",
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="flex min-h-dvh flex-col bg-slate-950 text-slate-100">
      <header class="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div class="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <a routerLink="/" class="flex items-center gap-2">
            <span class="grid h-8 w-8 place-items-center rounded-lg bg-cyan-400 font-bold text-slate-950">e</span>
            <span class="text-lg font-semibold tracking-tight">easyRAG</span>
          </a>
          <nav class="hidden items-center gap-6 text-sm text-slate-300 md:flex">
            <a routerLink="/pricing" routerLinkActive="text-white" class="hover:text-white">Pricing</a>
            <a routerLink="/faq" routerLinkActive="text-white" class="hover:text-white">FAQ</a>
            @if (auth.isAuthenticated()) {
              <a routerLink="/app" class="rounded-xl bg-cyan-400 px-4 py-2 font-semibold text-slate-950 hover:bg-cyan-300">Open workspace</a>
            } @else {
              <button type="button" class="hover:text-white" (click)="signIn()">Sign in</button>
              <button type="button" class="rounded-xl bg-cyan-400 px-4 py-2 font-semibold text-slate-950 hover:bg-cyan-300" (click)="signUp()">
                Get started
              </button>
            }
          </nav>
          <button type="button" class="rounded-lg border border-slate-800 px-3 py-1.5 text-sm md:hidden" (click)="menuOpen.set(!menuOpen())">
            Menu
          </button>
        </div>
        @if (menuOpen()) {
          <div class="border-t border-slate-800 px-5 py-4 md:hidden">
            <div class="flex flex-col gap-3 text-sm">
              <a routerLink="/pricing" (click)="menuOpen.set(false)">Pricing</a>
              <a routerLink="/faq" (click)="menuOpen.set(false)">FAQ</a>
              @if (auth.isAuthenticated()) {
                <a routerLink="/app" class="font-semibold text-cyan-300">Open workspace</a>
              } @else {
                <button type="button" class="text-left" (click)="signIn()">Sign in</button>
                <button type="button" class="text-left font-semibold text-cyan-300" (click)="signUp()">Get started</button>
              }
            </div>
          </div>
        }
      </header>

      @if (config.loadError()) {
        <div class="border-b border-amber-500/30 bg-amber-500/10 px-5 py-2 text-center text-xs text-amber-200">
          The API is unreachable right now; sign-in is temporarily unavailable.
        </div>
      }

      <main class="flex-1">
        <router-outlet />
      </main>

      <footer class="border-t border-slate-800/80">
        <div class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-slate-400 md:flex-row">
          <p>© {{ year }} easyRAG. Bring your own model key; keep your documents private.</p>
          <nav class="flex gap-5">
            <a routerLink="/pricing" class="hover:text-white">Pricing</a>
            <a routerLink="/faq" class="hover:text-white">FAQ</a>
            <a routerLink="/terms" class="hover:text-white">Terms</a>
            <a routerLink="/privacy" class="hover:text-white">Privacy</a>
          </nav>
        </div>
      </footer>
    </div>
  `,
})
export class PublicShell {
  readonly auth = inject(AuthService);
  readonly config = inject(ConfigService);
  readonly menuOpen = signal(false);
  readonly year = new Date().getFullYear();

  constructor() {
    if (this.config.config()) {
      void this.auth.restore();
    }
  }

  signIn(): void {
    void this.auth.login("/app");
  }

  signUp(): void {
    void this.auth.signup("/app");
  }
}
