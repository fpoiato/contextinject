import { firstValueFrom } from "rxjs";
import { HttpClient, HttpHeaders } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { environment } from "./environment";
import { SettingsService } from "./settings.service";

export interface DocumentItem {
  id: string;
  filename: string;
  status: string;
  bytes: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatSession {
  id: string;
  title: string | null;
  created_at: string;
}

export interface SourceHit {
  id: string;
  filename: string;
  page: number | null;
  content: string;
  score: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: SourceHit[];
  model?: string;
}

@Injectable({ providedIn: "root" })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly settings = inject(SettingsService);
  readonly baseUrl = environment.apiUrl;

  private headers(extra: Record<string, string> = {}): HttpHeaders {
    const current = this.settings.settings();
    return new HttpHeaders({
      "Content-Type": "application/json",
      "X-User-Id": current.userId,
      ...extra,
    });
  }

  health() {
    return this.http.get<{ ok: boolean }>(`${this.baseUrl}/health`);
  }

  dbStatus() {
    return this.http.get<{ status: string }>(`${this.baseUrl}/db`);
  }

  startDb() {
    return this.http.post<{ status: string; message: string }>(`${this.baseUrl}/db/start`, {}, { headers: this.headers() });
  }

  stopDb() {
    return this.http.post<{ status: string; message: string }>(`${this.baseUrl}/db/stop`, {}, { headers: this.headers() });
  }

  documents() {
    return this.http.get<{ documents: DocumentItem[] }>(`${this.baseUrl}/documents`, { headers: this.headers() });
  }

  sessions() {
    return this.http.get<{ sessions: ChatSession[] }>(`${this.baseUrl}/sessions`, { headers: this.headers() });
  }

  sessionMessages(sessionId: string) {
    return this.http.get<{ messages: ChatMessage[] }>(`${this.baseUrl}/sessions/${sessionId}`, {
      headers: this.headers(),
    });
  }

  presign(file: File) {
    return this.http.post<{ url: string; key: string; filename: string; contentType: string }>(
      `${this.baseUrl}/uploads/presign`,
      { filename: file.name, contentType: file.type || "application/octet-stream" },
      { headers: this.headers() },
    );
  }

  completeUpload(key: string, filename: string, contentType: string) {
    return this.http.post<{ ok: boolean }>(
      `${this.baseUrl}/uploads/complete`,
      { key, filename, contentType },
      { headers: this.headers() },
    );
  }

  async uploadFile(file: File): Promise<void> {
    const signed = await firstValueFrom(this.presign(file));
    const put = await fetch(signed.url, {
      method: "PUT",
      headers: { "Content-Type": signed.contentType },
      body: file,
    });
    if (!put.ok) {
      throw new Error(`S3 upload failed (${put.status})`);
    }
    await firstValueFrom(this.completeUpload(signed.key, signed.filename, signed.contentType));
  }

  async streamChat(
    message: string,
    sessionId: string | null,
    onEvent: (event: Record<string, unknown>) => void,
  ): Promise<void> {
    const current = this.settings.settings();
    const response = await fetch(`${this.baseUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": current.userId,
        "X-Api-Key": current.apiKey,
        "X-Model": current.model,
        "X-Provider": current.provider,
      },
      body: JSON.stringify({
        message,
        sessionId,
        model: current.model,
        provider: current.provider,
        apiKey: current.apiKey,
      }),
    });
    if (!response.ok || !response.body) {
      const detail = await response.text();
      throw new Error(detail || `Chat failed (${response.status})`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const line = chunk
          .split("\n")
          .filter((item) => item.startsWith("data:"))
          .map((item) => item.slice(5).trim())
          .join("");
        if (!line || line === "[DONE]") continue;
        try {
          onEvent(JSON.parse(line) as Record<string, unknown>);
        } catch {
          continue;
        }
      }
    }
  }
}
