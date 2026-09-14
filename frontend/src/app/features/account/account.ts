import { Component, EventEmitter, Output, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { ApiService, describeError, type KeyEntry } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { ConfigService } from "../../core/config.service";
import { formatBytes } from "../../core/format";
import { PROVIDERS, SettingsService } from "../../core/settings.service";
import { WorkspaceStore } from "../../core/workspace.store";

type Tab = "keys" | "usage" | "database";

@Component({
  selector: "app-account",
  imports: [FormsModule, RouterLink],
  templateUrl: "./account.html",
})
export class Account {
  private readonly api = inject(ApiService);
  readonly store = inject(WorkspaceStore);
  readonly auth = inject(AuthService);
  readonly config = inject(ConfigService);
  readonly settings = inject(SettingsService);

  @Output() readonly closed = new EventEmitter<void>();

  readonly bytes = formatBytes;
  readonly providers = PROVIDERS;
  readonly tab = signal<Tab>("keys");
  readonly keys = signal<KeyEntry[]>(this.store.me()?.keys ?? []);
  readonly drafts: Record<string, string> = {};
  readonly busyProvider = signal<string | null>(null);
  readonly message = signal("");
  readonly messageIsError = signal(false);
  readonly dbStatus = signal("checking…");
  readonly dbBusy = signal(false);

  constructor() {
    if (!this.store.me()) {
      void this.store.refreshMe().then(() => this.keys.set(this.store.me()?.keys ?? []));
    }
    this.refreshDb();
  }

  maskedFor(provider: string): string | null {
    return this.keys().find((item) => item.provider === provider)?.masked ?? null;
  }

  async saveKey(provider: string): Promise<void> {
    const value = (this.drafts[provider] ?? "").trim();
    if (!value) {
      return;
    }
    this.busyProvider.set(provider);
    try {
      const response = await firstValueFrom(this.api.setKey(provider, value));
      this.keys.set(response.keys);
      this.drafts[provider] = "";
      this.notify(`${this.label(provider)} key saved securely.`, false);
      await this.store.refreshMe();
    } catch (err) {
      this.notify(describeError(err, "Could not save the key"), true);
    } finally {
      this.busyProvider.set(null);
    }
  }

  async removeKey(provider: string): Promise<void> {
    if (!window.confirm(`Remove your ${this.label(provider)} key?`)) {
      return;
    }
    this.busyProvider.set(provider);
    try {
      const response = await firstValueFrom(this.api.deleteKey(provider));
      this.keys.set(response.keys);
      this.notify(`${this.label(provider)} key removed.`, false);
      await this.store.refreshMe();
    } catch (err) {
      this.notify(describeError(err, "Could not remove the key"), true);
    } finally {
      this.busyProvider.set(null);
    }
  }

  refreshDb(): void {
    this.api.dbStatus().subscribe({
      next: (res) => this.dbStatus.set(res.status),
      error: () => this.dbStatus.set("unreachable"),
    });
  }

  startDb(): void {
    this.dbBusy.set(true);
    this.api.startDb().subscribe({
      next: (res) => {
        this.dbStatus.set(res.status);
        this.notify(`${res.message}. It takes about 3–5 minutes to become available.`, false);
        this.dbBusy.set(false);
        this.store.dbStopped.set(false);
      },
      error: (err: unknown) => {
        this.notify(describeError(err, "Could not start the database"), true);
        this.dbBusy.set(false);
      },
    });
  }

  stopDb(): void {
    if (!window.confirm("Stop the database for everyone?")) {
      return;
    }
    this.dbBusy.set(true);
    this.api.stopDb().subscribe({
      next: (res) => {
        this.dbStatus.set(res.status);
        this.notify(res.message, false);
        this.dbBusy.set(false);
      },
      error: (err: unknown) => {
        this.notify(describeError(err, "Could not stop the database"), true);
        this.dbBusy.set(false);
      },
    });
  }

  toggleDark(): void {
    this.settings.update({ darkMode: !this.settings.settings().darkMode });
  }

  label(provider: string): string {
    return PROVIDERS.find((item) => item.id === provider)?.label ?? provider;
  }

  private notify(text: string, isError: boolean): void {
    this.message.set(text);
    this.messageIsError.set(isError);
  }
}
