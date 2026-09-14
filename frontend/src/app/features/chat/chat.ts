import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ApiService, type ChatMessage, type ChatSession, type SourceHit } from "../../core/api.service";
import { SettingsService } from "../../core/settings.service";

@Component({
  selector: "app-chat",
  imports: [FormsModule],
  templateUrl: "./chat.html",
})
export class Chat {
  private readonly api = inject(ApiService);
  readonly settings = inject(SettingsService);

  readonly sessions = signal<ChatSession[]>([]);
  readonly messages = signal<ChatMessage[]>([]);
  readonly sources = signal<SourceHit[]>([]);
  readonly sessionId = signal<string | null>(null);
  draft = "";
  readonly streaming = signal(false);
  readonly error = signal("");

  constructor() {
    this.refreshSessions();
  }

  refreshSessions(): void {
    this.api.sessions().subscribe({
      next: (res) => this.sessions.set(res.sessions),
      error: () => undefined,
    });
  }

  newChat(): void {
    this.sessionId.set(null);
    this.messages.set([]);
    this.sources.set([]);
    this.error.set("");
  }

  openSession(id: string): void {
    this.sessionId.set(id);
    this.api.sessionMessages(id).subscribe({
      next: (res) => {
        this.messages.set(
          res.messages.map((item) => ({
            role: item.role,
            content: item.content,
            sources: item.sources,
            model: item.model,
          })),
        );
        const last = [...res.messages].reverse().find((item) => item.role === "assistant");
        this.sources.set(last?.sources ?? []);
      },
    });
  }

  async send(): Promise<void> {
    const text = this.draft.trim();
    if (!text || this.streaming()) {
      return;
    }
    this.draft = "";
    this.error.set("");
    this.messages.update((items) => [...items, { role: "user", content: text }]);
    this.messages.update((items) => [...items, { role: "assistant", content: "" }]);
    this.streaming.set(true);
    try {
      await this.api.streamChat(text, this.sessionId(), (event) => {
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
        }
        if (event["type"] === "error") {
          this.error.set(String(event["error"] || "Chat error"));
        }
      });
      this.refreshSessions();
    } catch (err) {
      this.error.set(this.parseError(err));
    } finally {
      this.streaming.set(false);
    }
  }

  private parseError(err: unknown): string {
    if (err instanceof Error) {
      try {
        const parsed = JSON.parse(err.message) as { error?: string; code?: string };
        if (parsed.code === "DB_STOPPED") {
          return "The database is stopped. Open Settings and start it.";
        }
        return parsed.error || err.message;
      } catch {
        return err.message;
      }
    }
    return "Chat failed";
  }
}
