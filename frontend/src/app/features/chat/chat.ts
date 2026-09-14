import { Component, ElementRef, ViewChild, effect, inject, signal, untracked } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { firstValueFrom } from "rxjs";
import { ApiService, describeError, type ChatMessage, type ChatSession, type SourceHit } from "../../core/api.service";
import { MODEL_OPTIONS, PROVIDERS, SettingsService, modelsForProvider } from "../../core/settings.service";
import { WorkspaceStore } from "../../core/workspace.store";

@Component({
  selector: "app-chat",
  imports: [FormsModule],
  templateUrl: "./chat.html",
})
export class Chat {
  private readonly api = inject(ApiService);
  readonly settings = inject(SettingsService);
  readonly store = inject(WorkspaceStore);

  @ViewChild("scroller") private scroller?: ElementRef<HTMLDivElement>;

  readonly sessions = signal<ChatSession[]>([]);
  readonly messages = signal<ChatMessage[]>([]);
  readonly sources = signal<SourceHit[]>([]);
  readonly sessionId = signal<string | null>(null);
  readonly streaming = signal(false);
  readonly error = signal("");
  readonly needsKey = signal(false);
  draft = "";

  readonly providers = PROVIDERS;
  readonly allModels = MODEL_OPTIONS;

  constructor() {
    effect(() => {
      const projectId = this.store.currentProjectId();
      untracked(() => {
        this.newChat();
        if (projectId) {
          void this.refreshSessions(projectId);
        } else {
          this.sessions.set([]);
        }
      });
    });
  }

  models() {
    return modelsForProvider(this.settings.settings().provider);
  }

  setProvider(event: Event): void {
    const provider = (event.target as HTMLSelectElement).value;
    const options = modelsForProvider(provider);
    const model = options.some((item) => item.id === this.settings.settings().model) ? this.settings.settings().model : options[0]?.id;
    this.settings.update({ provider, model });
    this.needsKey.set(false);
  }

  setModel(event: Event): void {
    this.settings.update({ model: (event.target as HTMLSelectElement).value });
  }

  async refreshSessions(projectId: string): Promise<void> {
    try {
      const response = await firstValueFrom(this.api.sessions(projectId));
      if (this.store.currentProjectId() === projectId) {
        this.sessions.set(response.sessions);
      }
    } catch {
      return;
    }
  }

  newChat(): void {
    this.sessionId.set(null);
    this.messages.set([]);
    this.sources.set([]);
    this.error.set("");
  }

  async openSession(event: Event): Promise<void> {
    const id = (event.target as HTMLSelectElement).value;
    if (!id) {
      this.newChat();
      return;
    }
    this.sessionId.set(id);
    this.error.set("");
    try {
      const response = await firstValueFrom(this.api.sessionMessages(id));
      this.messages.set(
        response.messages.map((item) => ({ role: item.role, content: item.content, sources: item.sources, model: item.model })),
      );
      const last = [...response.messages].reverse().find((item) => item.role === "assistant");
      this.sources.set(last?.sources ?? []);
      this.scrollToEnd();
    } catch (err) {
      this.error.set(describeError(err, "Could not load conversation"));
    }
  }

  async deleteCurrentSession(): Promise<void> {
    const id = this.sessionId();
    if (!id || !window.confirm("Delete this conversation?")) {
      return;
    }
    await firstValueFrom(this.api.deleteSession(id));
    this.newChat();
    const projectId = this.store.currentProjectId();
    if (projectId) {
      await this.refreshSessions(projectId);
    }
  }

  async send(): Promise<void> {
    const text = this.draft.trim();
    const projectId = this.store.currentProjectId();
    if (!text || this.streaming() || !projectId) {
      return;
    }
    this.draft = "";
    this.error.set("");
    this.needsKey.set(false);
    this.messages.update((items) => [...items, { role: "user", content: text }, { role: "assistant", content: "" }]);
    this.streaming.set(true);
    this.scrollToEnd();
    try {
      await this.api.streamChat(
        { projectId, folderId: this.store.currentFolderId(), message: text, sessionId: this.sessionId() },
        (event) => {
          if (event["type"] === "session") {
            this.sessionId.set(String(event["sessionId"]));
            this.sources.set((event["sources"] as SourceHit[]) || []);
          }
          if (event["type"] === "token") {
            const token = String(event["text"] || "");
            this.messages.update((items) => {
              const next = [...items];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = { ...last, content: last.content + token };
              }
              return next;
            });
            this.scrollToEnd();
          }
          if (event["type"] === "error") {
            this.error.set(String(event["error"] || "Chat error"));
          }
        },
      );
      await this.refreshSessions(projectId);
    } catch (err) {
      const body = (err as { error?: { code?: string } }).error;
      if (body?.code === "NO_API_KEY") {
        this.needsKey.set(true);
      }
      if (body?.code === "DB_STOPPED") {
        this.store.dbStopped.set(true);
      }
      this.error.set(describeError(err, "Chat failed"));
      this.messages.update((items) => (items.at(-1)?.role === "assistant" && !items.at(-1)?.content ? items.slice(0, -1) : items));
    } finally {
      this.streaming.set(false);
    }
  }

  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void this.send();
    }
  }

  private scrollToEnd(): void {
    queueMicrotask(() => {
      const element = this.scroller?.nativeElement;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }
}
