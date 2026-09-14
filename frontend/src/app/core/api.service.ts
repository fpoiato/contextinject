import { firstValueFrom } from "rxjs";
import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { AuthService } from "./auth.service";
import { environment } from "./environment";
import { SettingsService } from "./settings.service";

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  documentCount: number;
  bytes: number;
}

export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: string;
}

export interface DocumentItem {
  id: string;
  folderId: string | null;
  filename: string;
  contentType: string | null;
  status: string;
  bytes: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTree {
  folders: Folder[];
  documents: DocumentItem[];
}

export interface ChatSession {
  id: string;
  title: string | null;
  createdAt: string;
}

export interface SourceHit {
  id: string;
  filename: string;
  documentId?: string;
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

export interface KeyEntry {
  provider: string;
  masked: string;
}

export interface Me {
  sub: string;
  email: string;
  isAdmin: boolean;
  plan: { id: string; name: string; priceUsd: number; storageBytes: number; maxUploadBytes: number };
  usage: { bytes: number; limitBytes: number; documents: number };
  keys: KeyEntry[];
  settings: Record<string, unknown>;
  createdAt?: string;
}

export interface ApiErrorBody {
  error?: string;
  code?: string;
  stopped?: boolean;
}

export function describeError(err: unknown, fallback = "Something went wrong"): string {
  const body = (err as { error?: ApiErrorBody | string })?.error;
  if (body && typeof body === "object") {
    if (body.code === "DB_STOPPED") {
      return "The database is asleep. Wake it from Account → Database and try again in a few minutes.";
    }
    if (body.error) {
      return body.error;
    }
  }
  if (typeof body === "string" && body) {
    return body;
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

@Injectable({ providedIn: "root" })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly settings = inject(SettingsService);
  readonly baseUrl = environment.apiUrl;

  me() {
    return this.http.get<Me>(`${this.baseUrl}/me`);
  }

  updateSettings(settings: Record<string, unknown>) {
    return this.http.patch<Me>(`${this.baseUrl}/me`, { settings });
  }

  setKey(provider: string, apiKey: string) {
    return this.http.put<{ keys: KeyEntry[] }>(`${this.baseUrl}/me/keys/${provider}`, { apiKey });
  }

  deleteKey(provider: string) {
    return this.http.delete<{ keys: KeyEntry[] }>(`${this.baseUrl}/me/keys/${provider}`);
  }

  dbStatus() {
    return this.http.get<{ status: string }>(`${this.baseUrl}/db`);
  }

  startDb() {
    return this.http.post<{ status: string; message: string }>(`${this.baseUrl}/db/start`, {});
  }

  stopDb() {
    return this.http.post<{ status: string; message: string }>(`${this.baseUrl}/db/stop`, {});
  }

  projects() {
    return this.http.get<{ projects: Project[] }>(`${this.baseUrl}/projects`);
  }

  createProject(name: string) {
    return this.http.post<Project>(`${this.baseUrl}/projects`, { name });
  }

  renameProject(id: string, name: string) {
    return this.http.patch<Project>(`${this.baseUrl}/projects/${id}`, { name });
  }

  deleteProject(id: string) {
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/projects/${id}`);
  }

  tree(projectId: string) {
    return this.http.get<ProjectTree>(`${this.baseUrl}/projects/${projectId}/tree`);
  }

  createFolder(projectId: string, name: string, parentId: string | null) {
    return this.http.post<Folder>(`${this.baseUrl}/projects/${projectId}/folders`, { name, parentId });
  }

  updateFolder(id: string, changes: { name?: string; parentId?: string | null }) {
    return this.http.patch<Folder>(`${this.baseUrl}/folders/${id}`, changes);
  }

  deleteFolder(id: string) {
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/folders/${id}`);
  }

  updateDocument(id: string, changes: { filename?: string; folderId?: string | null }) {
    return this.http.patch<DocumentItem>(`${this.baseUrl}/documents/${id}`, changes);
  }

  deleteDocument(id: string) {
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/documents/${id}`);
  }

  sessions(projectId: string) {
    return this.http.get<{ sessions: ChatSession[] }>(`${this.baseUrl}/projects/${projectId}/sessions`);
  }

  sessionMessages(sessionId: string) {
    return this.http.get<{ messages: ChatMessage[] }>(`${this.baseUrl}/sessions/${sessionId}`);
  }

  deleteSession(sessionId: string) {
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/sessions/${sessionId}`);
  }

  async uploadFile(projectId: string, folderId: string | null, file: File): Promise<void> {
    const signed = await firstValueFrom(
      this.http.post<{ url: string; documentId: string; contentType: string }>(
        `${this.baseUrl}/projects/${projectId}/uploads/presign`,
        { filename: file.name, contentType: file.type || "application/octet-stream", size: file.size, folderId },
      ),
    );
    const put = await fetch(signed.url, {
      method: "PUT",
      headers: { "Content-Type": signed.contentType },
      body: file,
    });
    if (!put.ok) {
      await firstValueFrom(this.deleteDocument(signed.documentId)).catch(() => undefined);
      throw new Error(`Upload to storage failed (${put.status})`);
    }
    await firstValueFrom(this.http.post<{ ok: boolean }>(`${this.baseUrl}/uploads/complete`, { documentId: signed.documentId }));
  }

  async streamChat(
    input: { projectId: string; folderId: string | null; message: string; sessionId: string | null },
    onEvent: (event: Record<string, unknown>) => void,
  ): Promise<void> {
    const current = this.settings.settings();
    const token = await this.auth.idToken();
    const response = await fetch(`${this.baseUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        message: input.message,
        sessionId: input.sessionId,
        projectId: input.projectId,
        folderId: input.folderId,
        model: current.model,
        provider: current.provider,
      }),
    });
    if (!response.ok || !response.body) {
      const detail = await response.text();
      let parsed: ApiErrorBody = {};
      try {
        parsed = JSON.parse(detail) as ApiErrorBody;
      } catch {
        parsed = { error: detail };
      }
      throw Object.assign(new Error(parsed.error || `Chat failed (${response.status})`), { error: parsed, status: response.status });
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
