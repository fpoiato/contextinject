import { Component, inject } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { ConfigService } from "../../core/config.service";
import { formatBytes } from "../../core/format";

@Component({
  selector: "app-landing",
  imports: [RouterLink],
  template: `
    <section class="relative overflow-hidden">
      <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.18),transparent_60%)]"></div>
      <div class="mx-auto grid max-w-6xl gap-12 px-5 py-20 md:grid-cols-2 md:items-center md:py-28">
        <div>
          <p class="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-200">
            Private RAG for your documents
          </p>
          <h1 class="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            Ask questions. Get answers grounded in <span class="text-cyan-300">your</span> files.
          </h1>
          <p class="mt-5 max-w-xl text-lg text-slate-300">
            Upload PDFs, notes and spreadsheets into projects and folders. easyRAG indexes them with vector search and lets
            you chat with any frontier model using your own API key.
          </p>
          <div class="mt-8 flex flex-wrap gap-3">
            <button type="button" class="rounded-xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-300" (click)="start()">
              Start for {{ starterPrice }}/month
            </button>
            <a routerLink="/pricing" class="rounded-xl border border-slate-700 px-5 py-3 font-medium text-slate-200 hover:border-slate-500">
              See pricing
            </a>
          </div>
          <p class="mt-4 text-xs text-slate-500">Bring your own OpenAI, Anthropic, Gemini, xAI or OpenRouter key. Cancel anytime.</p>
        </div>

        <div class="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 shadow-2xl shadow-cyan-500/5">
          <div class="mb-4 flex items-center gap-2 text-xs text-slate-400">
            <span class="h-2.5 w-2.5 rounded-full bg-rose-400"></span>
            <span class="h-2.5 w-2.5 rounded-full bg-amber-400"></span>
            <span class="h-2.5 w-2.5 rounded-full bg-emerald-400"></span>
            <span class="ml-2">Contracts / 2026 / vendor-agreement.pdf</span>
          </div>
          <div class="space-y-3 text-sm">
            <div class="ml-auto max-w-[85%] rounded-2xl bg-cyan-500/15 px-4 py-3">
              What is the termination notice period in the vendor agreement?
            </div>
            <div class="max-w-[90%] rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 leading-6 text-slate-200">
              Either party may terminate with <strong>60 days written notice</strong> [#1]. Termination for material breach
              requires a 15-day cure period [#2].
              <div class="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400">
                <span class="rounded-full border border-slate-800 px-2 py-0.5">[#1] vendor-agreement.pdf · p.12</span>
                <span class="rounded-full border border-slate-800 px-2 py-0.5">[#2] vendor-agreement.pdf · p.13</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="border-t border-slate-800/80 bg-slate-950">
      <div class="mx-auto grid max-w-6xl gap-6 px-5 py-16 md:grid-cols-3">
        @for (feature of features; track feature.title) {
          <article class="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
            <div class="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-cyan-500/15 text-cyan-300">{{ feature.icon }}</div>
            <h3 class="text-base font-semibold">{{ feature.title }}</h3>
            <p class="mt-2 text-sm leading-6 text-slate-400">{{ feature.body }}</p>
          </article>
        }
      </div>
    </section>

    <section class="border-t border-slate-800/80">
      <div class="mx-auto max-w-6xl px-5 py-16">
        <h2 class="text-2xl font-semibold">How it works</h2>
        <ol class="mt-8 grid gap-6 md:grid-cols-4">
          @for (step of steps; track step.title; let i = $index) {
            <li class="rounded-2xl border border-slate-800 p-5">
              <p class="text-xs font-semibold text-cyan-300">Step {{ i + 1 }}</p>
              <h3 class="mt-1 font-semibold">{{ step.title }}</h3>
              <p class="mt-2 text-sm leading-6 text-slate-400">{{ step.body }}</p>
            </li>
          }
        </ol>
      </div>
    </section>

    <section class="border-t border-slate-800/80 bg-slate-900/40">
      <div class="mx-auto max-w-6xl px-5 py-16">
        <div class="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <div>
            <h2 class="text-2xl font-semibold">Simple storage-based pricing</h2>
            <p class="mt-2 max-w-xl text-slate-400">
              You pay for the documents you keep indexed. Model usage is billed by your own provider, at cost, with no markup.
            </p>
          </div>
          <a routerLink="/pricing" class="text-sm font-medium text-cyan-300 hover:text-cyan-200">Compare plans →</a>
        </div>
        <div class="mt-8 grid gap-4 md:grid-cols-3">
          @for (plan of config.plans; track plan.id) {
            <div class="rounded-2xl border border-slate-800 bg-slate-950 p-6">
              <p class="text-sm text-slate-400">{{ plan.name }}</p>
              <p class="mt-1 text-3xl font-semibold">{{ '$' + plan.priceUsd }}<span class="text-base font-normal text-slate-500">/mo</span></p>
              <p class="mt-2 text-sm text-slate-300">Up to {{ bytes(plan.storageBytes) }} of documents</p>
            </div>
          }
        </div>
      </div>
    </section>

    <section class="border-t border-slate-800/80">
      <div class="mx-auto flex max-w-6xl flex-col items-center px-5 py-20 text-center">
        <h2 class="text-3xl font-semibold">Your knowledge base, ready in minutes</h2>
        <p class="mt-3 max-w-lg text-slate-400">Create an account, add your model key, drop in your first documents and start asking.</p>
        <button type="button" class="mt-8 rounded-xl bg-cyan-400 px-6 py-3 font-semibold text-slate-950 hover:bg-cyan-300" (click)="start()">
          Create your account
        </button>
      </div>
    </section>
  `,
})
export class Landing {
  readonly config = inject(ConfigService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly bytes = formatBytes;

  get starterPrice(): string {
    const starter = this.config.plans.find((plan) => plan.id === "starter") ?? this.config.plans[0];
    return `$${starter?.priceUsd ?? 10}`;
  }

  readonly features = [
    { icon: "📁", title: "Projects and folders", body: "Organize documents the way your team already thinks: by client, by product, by year. Chat within a whole project or a single folder." },
    { icon: "🔑", title: "Bring your own key", body: "Use your OpenAI, Anthropic, Gemini, xAI or OpenRouter key. It is stored encrypted in AWS Secrets Manager and never leaves our servers." },
    { icon: "📎", title: "Answers with citations", body: "Every reply lists the exact chunks it used, with file name and page, so you can verify before you trust." },
    { icon: "🔒", title: "Private by default", body: "Each account is isolated. Documents live in your private storage prefix and are only ever retrieved for your questions." },
    { icon: "⚡", title: "Frontier models", body: "Switch between GPT, Claude, Gemini, Grok, Llama and more without re-indexing anything." },
    { icon: "🧮", title: "Predictable cost", body: "A flat monthly fee based on storage. Model tokens are billed directly by your provider, with zero markup." },
  ];

  readonly steps = [
    { title: "Create an account", body: "Sign up with your email. No credit card needed to explore the workspace." },
    { title: "Add your model key", body: "Paste a key from your preferred provider. It is saved securely on the server side." },
    { title: "Upload documents", body: "Drag PDFs, Markdown, text or CSV files into a project or folder. Indexing starts immediately." },
    { title: "Ask anything", body: "Chat with the whole project or narrow the scope to one folder. Sources are cited inline." },
  ];

  start(): void {
    if (this.auth.isAuthenticated()) {
      void this.router.navigateByUrl("/app");
      return;
    }
    void this.router.navigateByUrl("/signup");
  }
}
