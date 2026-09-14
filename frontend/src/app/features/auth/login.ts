import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";

@Component({
  selector: "app-login",
  imports: [FormsModule, RouterLink],
  template: `
    <section class="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-5 py-16">
      <h1 class="text-3xl font-semibold tracking-tight">Sign in</h1>
      <p class="mt-2 text-sm text-slate-400">Use your email. You stay on this site — no Cognito redirect.</p>

      @if (challengeSession()) {
        <form class="mt-8 space-y-4" (ngSubmit)="completeNewPassword()">
          <p class="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            Cognito asked for a new password before we can open your workspace.
          </p>
          <label class="block text-sm">
            <span class="text-slate-300">New password</span>
            <input
              class="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-cyan-400"
              type="password"
              name="newPassword"
              [(ngModel)]="newPassword"
              autocomplete="new-password"
              required
            />
          </label>
          @if (error()) {
            <p class="text-sm text-rose-300">{{ error() }}</p>
          }
          <button
            class="w-full rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-60"
            type="submit"
            [disabled]="busy()"
          >
            {{ busy() ? "Updating…" : "Save password and continue" }}
          </button>
        </form>
      } @else {
        <form class="mt-8 space-y-4" (ngSubmit)="submit()">
          <label class="block text-sm">
            <span class="text-slate-300">Email</span>
            <input
              class="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-cyan-400"
              type="email"
              name="email"
              [(ngModel)]="email"
              autocomplete="username"
              required
            />
          </label>
          <label class="block text-sm">
            <span class="text-slate-300">Password</span>
            <input
              class="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-cyan-400"
              type="password"
              name="password"
              [(ngModel)]="password"
              autocomplete="current-password"
              required
            />
          </label>
          @if (error()) {
            <p class="text-sm text-rose-300">{{ error() }}</p>
          }
          <button
            class="w-full rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-60"
            type="submit"
            [disabled]="busy()"
          >
            {{ busy() ? "Signing in…" : "Sign in" }}
          </button>
        </form>
      }

      <div class="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
        <a routerLink="/forgot" [queryParams]="{ email }" class="hover:text-white">Forgot password?</a>
        <a routerLink="/signup" class="font-medium text-cyan-300 hover:text-cyan-200">Create an account</a>
      </div>
    </section>
  `,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  email = this.route.snapshot.queryParamMap.get("email") ?? "";
  password = "";
  newPassword = "";
  readonly busy = signal(false);
  readonly error = signal("");
  readonly challengeSession = signal("");

  async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set("");
    try {
      const result = await this.auth.login(this.email, this.password);
      if ("challenge" in result) {
        this.challengeSession.set(result.session);
        this.email = result.email;
        return;
      }
      await this.finish();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "UNCONFIRMED") {
        await this.router.navigate(["/verify"], { queryParams: { email: this.email } });
        return;
      }
      this.error.set(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      this.busy.set(false);
    }
  }

  async completeNewPassword(): Promise<void> {
    this.busy.set(true);
    this.error.set("");
    try {
      await this.auth.completeChallenge(this.email, this.challengeSession(), this.newPassword);
      await this.finish();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : "Could not update the password");
    } finally {
      this.busy.set(false);
    }
  }

  private async finish(): Promise<void> {
    const returnTo = this.route.snapshot.queryParamMap.get("returnTo") || "/app";
    await this.router.navigateByUrl(returnTo.startsWith("/") ? returnTo : "/app");
  }
}
