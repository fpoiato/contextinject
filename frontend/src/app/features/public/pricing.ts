import { Component, inject } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { ConfigService } from "../../core/config.service";
import { formatBytes } from "../../core/format";

@Component({
  selector: "app-pricing",
  imports: [RouterLink],
  template: `
    <section class="mx-auto max-w-6xl px-5 py-16">
      <div class="max-w-2xl">
        <h1 class="text-4xl font-semibold tracking-tight">Pricing that scales with your library</h1>
        <p class="mt-4 text-lg text-slate-300">
          Every plan includes unlimited projects, folders, questions and every supported model. You pay for the documents
          you keep indexed; model usage is charged by your provider through your own API key.
        </p>
      </div>

      <div class="mt-12 grid gap-6 md:grid-cols-3">
        @for (plan of config.plans; track plan.id; let i = $index) {
          <article
            class="flex flex-col rounded-3xl border p-7"
            [class.border-cyan-400]="i === 1"
            [class.bg-cyan-500/5]="i === 1"
            [class.border-slate-800]="i !== 1"
            [class.bg-slate-900/40]="i !== 1"
          >
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold">{{ plan.name }}</h2>
              @if (i === 1) {
                <span class="rounded-full bg-cyan-400 px-2 py-0.5 text-xs font-semibold text-slate-950">Most popular</span>
              }
            </div>
            <p class="mt-4 text-4xl font-semibold">{{ '$' + plan.priceUsd }}<span class="text-base font-normal text-slate-500">/month</span></p>
            <p class="mt-1 text-sm text-slate-400">Up to {{ bytes(plan.storageBytes) }} of stored documents</p>
            <ul class="mt-6 space-y-2 text-sm text-slate-300">
              <li>✓ Unlimited projects and folders</li>
              <li>✓ Unlimited questions</li>
              <li>✓ Files up to {{ bytes(plan.maxUploadBytes) }}</li>
              <li>✓ All models, bring your own key</li>
              <li>✓ Citations on every answer</li>
              <li>✓ Delete anything, anytime</li>
            </ul>
            <button
              type="button"
              class="mt-8 rounded-xl px-4 py-3 text-sm font-semibold"
              [class.bg-cyan-400]="i === 1"
              [class.text-slate-950]="i === 1"
              [class.border]="i !== 1"
              [class.border-slate-700]="i !== 1"
              (click)="choose()"
            >
              Choose {{ plan.name }}
            </button>
          </article>
        }
      </div>

      <div class="mt-8 flex flex-col items-start justify-between gap-4 rounded-3xl border border-slate-800 bg-slate-900/40 p-7 md:flex-row md:items-center">
        <div>
          <h2 class="text-lg font-semibold">More than 200 GB?</h2>
          <p class="mt-1 text-sm text-slate-400">We set up dedicated capacity, custom retention and invoicing for larger libraries.</p>
        </div>
        <a href="mailto:hello@fpoiato.com?subject=easyRAG%20enterprise" class="rounded-xl border border-slate-700 px-5 py-3 text-sm font-medium hover:border-slate-500">
          Contact us
        </a>
      </div>

      <div class="mt-16 grid gap-8 md:grid-cols-2">
        <div>
          <h3 class="font-semibold">What counts toward storage?</h3>
          <p class="mt-2 text-sm leading-6 text-slate-400">
            The original size of every document currently in your projects. Delete a file and the space is freed instantly.
            Vector indexes and chat history do not count.
          </p>
        </div>
        <div>
          <h3 class="font-semibold">How are model costs billed?</h3>
          <p class="mt-2 text-sm leading-6 text-slate-400">
            Directly by OpenAI, Anthropic, Google, xAI or OpenRouter to the key you provide. easyRAG adds no markup and never
            sees your invoices.
          </p>
        </div>
        <div>
          <h3 class="font-semibold">Can I change plans?</h3>
          <p class="mt-2 text-sm leading-6 text-slate-400">
            Yes. Upgrade whenever you approach your limit; downgrade once your usage fits the smaller plan.
          </p>
        </div>
        <div>
          <h3 class="font-semibold">Still have questions?</h3>
          <p class="mt-2 text-sm leading-6 text-slate-400">
            Read the <a routerLink="/faq" class="text-cyan-300 hover:text-cyan-200">FAQ</a> or write to
            <a href="mailto:hello@fpoiato.com" class="text-cyan-300 hover:text-cyan-200">hello@fpoiato.com</a>.
          </p>
        </div>
      </div>
    </section>
  `,
})
export class Pricing {
  readonly config = inject(ConfigService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly bytes = formatBytes;

  choose(): void {
    if (this.auth.isAuthenticated()) {
      void this.router.navigateByUrl("/app");
      return;
    }
    void this.router.navigateByUrl("/signup");
  }
}
