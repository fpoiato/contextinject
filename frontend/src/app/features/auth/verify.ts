import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";

@Component({
  selector: "app-verify",
  imports: [FormsModule, RouterLink],
  template: `
    <section class="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-5 py-16">
      <h1 class="text-3xl font-semibold tracking-tight">Check your email</h1>
      <p class="mt-2 text-sm text-slate-400">
        Enter the code we sent to <span class="text-slate-200">{{ email }}</span> to confirm the account.
      </p>

      <form class="mt-8 space-y-4" (ngSubmit)="submit()">
        <label class="block text-sm">
          <span class="text-slate-300">Confirmation code</span>
          <input
            class="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm tracking-[0.3em] outline-none focus:border-cyan-400"
            name="code"
            [(ngModel)]="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            required
          />
        </label>
        @if (error()) {
          <p class="text-sm text-rose-300">{{ error() }}</p>
        }
        @if (info()) {
          <p class="text-sm text-cyan-200">{{ info() }}</p>
        }
        <button
          class="w-full rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-60"
          type="submit"
          [disabled]="busy()"
        >
          {{ busy() ? "Confirming…" : "Confirm email" }}
        </button>
      </form>

      <button type="button" class="mt-4 text-left text-sm text-slate-400 hover:text-white" (click)="resend()" [disabled]="busy()">
        Resend code
      </button>
      <p class="mt-6 text-sm text-slate-400">
        Wrong email?
        <a routerLink="/signup" class="font-medium text-cyan-300 hover:text-cyan-200">Start over</a>
      </p>
    </section>
  `,
})
export class Verify {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  email = this.route.snapshot.queryParamMap.get("email") ?? "";
  code = "";
  readonly busy = signal(false);
  readonly error = signal("");
  readonly info = signal("");

  async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set("");
    try {
      await this.auth.confirm(this.email, this.code);
      await this.router.navigate(["/login"], { queryParams: { email: this.email } });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : "Could not confirm the account");
    } finally {
      this.busy.set(false);
    }
  }

  async resend(): Promise<void> {
    this.busy.set(true);
    this.error.set("");
    this.info.set("");
    try {
      await this.auth.resend(this.email);
      this.info.set("A new code is on the way.");
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : "Could not resend the code");
    } finally {
      this.busy.set(false);
    }
  }
}
