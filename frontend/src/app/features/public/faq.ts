import { Component } from "@angular/core";
import { RouterLink } from "@angular/router";

@Component({
  selector: "app-faq",
  imports: [RouterLink],
  template: `
    <section class="mx-auto max-w-3xl px-5 py-16">
      <h1 class="text-4xl font-semibold tracking-tight">Frequently asked questions</h1>
      <p class="mt-4 text-slate-300">Everything about how easyRAG handles your documents, keys and billing.</p>

      <div class="mt-10 divide-y divide-slate-800 rounded-3xl border border-slate-800 bg-slate-900/40">
        @for (item of items; track item.q) {
          <details class="group px-6 py-5">
            <summary class="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-medium">
              {{ item.q }}
              <span class="text-slate-500 transition group-open:rotate-45">+</span>
            </summary>
            <p class="mt-3 text-sm leading-7 text-slate-400">{{ item.a }}</p>
          </details>
        }
      </div>

      <p class="mt-10 text-sm text-slate-400">
        Compare plans on the <a routerLink="/pricing" class="text-cyan-300 hover:text-cyan-200">pricing page</a> or email
        <a href="mailto:hello@fpoiato.com" class="text-cyan-300 hover:text-cyan-200">hello@fpoiato.com</a>.
      </p>
    </section>
  `,
})
export class Faq {
  readonly items = [
    {
      q: "What is RAG and why does it matter?",
      a: "Retrieval-Augmented Generation finds the most relevant passages in your documents and hands them to the language model together with your question. The model answers from your content instead of guessing, and every answer cites the passages it used.",
    },
    {
      q: "Which file types are supported?",
      a: "PDF, Markdown, plain text, CSV and JSON today. Word and PowerPoint files are parsed when document parsing is enabled for your account. Scanned PDFs without a text layer are not OCR'd yet.",
    },
    {
      q: "Where is my API key stored?",
      a: "In AWS Secrets Manager, encrypted at rest, in a secret dedicated to your account. It is only read by our API when it forwards a chat request to the provider you chose. It is never sent to your browser and never logged.",
    },
    {
      q: "Do you charge for model tokens?",
      a: "No. Your provider bills you directly for the tokens used with your key. easyRAG only charges the monthly subscription for stored documents.",
    },
    {
      q: "Which models can I use?",
      a: "GPT-5.6 and GPT-6 from OpenAI, Claude Sonnet 5, Opus 5, Fable 5.1 and Haiku 4.5 from Anthropic, Gemini 3.8 and 3.5 from Google, Grok 4.6 from xAI, plus Llama, DeepSeek, Qwen and Mistral through OpenRouter. Retired model IDs are remapped automatically so old saved settings keep working.",
    },
    {
      q: "Can I delete documents?",
      a: "Yes. Deleting a document, folder or project removes the file from storage and its vector index immediately, and frees the space on your plan.",
    },
    {
      q: "Is my data used to train models?",
      a: "No. Documents are stored in a private prefix in your region and are only read to index them and to answer your questions. Whether a provider trains on API traffic is governed by that provider's terms for your own key.",
    },
    {
      q: "Can I scope a question to one folder?",
      a: "Yes. Select a folder in the sidebar and the chat will only retrieve passages from that folder and its subfolders. Select the project root to search everything.",
    },
    {
      q: "Why does the workspace sometimes say the database is asleep?",
      a: "During the beta the database is paused overnight to keep costs, and therefore your subscription, low. Waking it takes a few minutes; the workspace shows a button for that and retries automatically.",
    },
    {
      q: "Can I invite my team?",
      a: "Not yet. Accounts are individual today; shared organizations with role-based access are on the roadmap. Larger teams can contact us for early access.",
    },
    {
      q: "How do I cancel?",
      a: "From your account page at any time. Your documents are deleted 30 days after cancellation unless you delete them earlier.",
    },
  ];
}
