import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";

@Component({
  selector: "app-reset",
  imports: [FormsModule, RouterLink],
  template: `
    <section class="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-5 py-16">
      <h1 class="text-3xl font-semibold tracking-tight">Choose a new password</h1>
      <p class="mt-2 text-sm text-slate-400">
        Paste the code sent to <span class="text-slate-200">{{ email }}</span>.
      </p>

      <form class="mt-8 space-y-4" (ngSubmit)="submit()">
        <label class="block text-sm">
          <span class="text-slate-300">Code</span>
          <input
            class="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-cyan-400"
            name="code"
            [(ngModel)]="code"
            autocomplete="one-time-code"
            required
          />
        </label>
        <label class="block text-sm">
          <span class="text-slate-300">New password</span>
          <input
            class="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-cyan-400"
            type="password"
            name="password"
            [(ngModel)]="password"
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
          {{ busy() ? "Saving…" : "Update password" }}
        </button>
      </form>

      <p class="mt-6 text-sm text-slate-400">
        <a routerLink="/login" [queryParams]="{ email }" class="font-medium text-cyan-300 hover:text-cyan-200">Back to sign in</a>
      </p>
    </section>
  `,
})
export class Reset {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  email = this.route.snapshot.queryParamMap.get("email") ?? "";
  code = "";
  password = "";
  readonly busy = signal(false);
  readonly error = signal("");

  async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set("");
    try {
      await this.auth.resetPassword(this.email, this.code, this.password);
      await this.router.navigate(["/login"], { queryParams: { email: this.email } });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : "Could not reset the password");
    } finally {
      this.busy.set(false);
    }
  }
}
