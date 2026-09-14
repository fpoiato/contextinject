import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";

@Component({
  selector: "app-signup",
  imports: [FormsModule, RouterLink],
  template: `
    <section class="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-5 py-16">
      <h1 class="text-3xl font-semibold tracking-tight">Create your account</h1>
      <p class="mt-2 text-sm text-slate-400">Email and password only. We never send you to another domain to sign up.</p>

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
            autocomplete="new-password"
            required
          />
          <span class="mt-1 block text-xs text-slate-500">At least 10 characters, with uppercase, lowercase and a number.</span>
        </label>
        @if (error()) {
          <p class="text-sm text-rose-300">{{ error() }}</p>
        }
        <button
          class="w-full rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-60"
          type="submit"
          [disabled]="busy()"
        >
          {{ busy() ? "Creating…" : "Create account" }}
        </button>
      </form>

      <p class="mt-6 text-sm text-slate-400">
        Already have an account?
        <a routerLink="/login" class="font-medium text-cyan-300 hover:text-cyan-200">Sign in</a>
      </p>
    </section>
  `,
})
export class Signup {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  email = "";
  password = "";
  readonly busy = signal(false);
  readonly error = signal("");

  async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set("");
    try {
      const result = await this.auth.signup(this.email, this.password);
      await this.router.navigate(["/verify"], { queryParams: { email: result.email } });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : "Could not create the account");
    } finally {
      this.busy.set(false);
    }
  }
}
