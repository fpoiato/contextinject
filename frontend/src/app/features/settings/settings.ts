import { Component, EventEmitter, Output, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MODEL_OPTIONS, SettingsService } from "../../core/settings.service";
import { ApiService } from "../../core/api.service";

@Component({
  selector: "app-settings",
  imports: [FormsModule],
  templateUrl: "./settings.html",
})
export class Settings {
  private readonly settingsService = inject(SettingsService);
  private readonly api = inject(ApiService);

  @Output() readonly closed = new EventEmitter<void>();

  readonly models = MODEL_OPTIONS;
  apiKey = this.settingsService.settings().apiKey;
  provider = this.settingsService.settings().provider;
  model = this.settingsService.settings().model;
  darkMode = this.settingsService.settings().darkMode;
  readonly dbStatus = signal("checking...");
  readonly busy = signal(false);
  readonly message = signal("");

  constructor() {
    this.refreshDb();
  }

  save(): void {
    this.settingsService.update({
      apiKey: this.apiKey.trim(),
      provider: this.provider,
      model: this.model,
      darkMode: this.darkMode,
    });
    this.message.set("Settings saved locally in this browser.");
  }

  refreshDb(): void {
    this.api.dbStatus().subscribe({
      next: (res) => this.dbStatus.set(res.status),
      error: () => this.dbStatus.set("unreachable"),
    });
  }

  startDb(): void {
    this.busy.set(true);
    this.api.startDb().subscribe({
      next: (res) => {
        this.dbStatus.set(res.status);
        this.message.set(`${res.message}. Wait about 5 minutes before chatting.`);
        this.busy.set(false);
      },
      error: (err: { error?: { error?: string } }) => {
        this.message.set(err.error?.error || "Could not start the database.");
        this.busy.set(false);
      },
    });
  }

  stopDb(): void {
    this.busy.set(true);
    this.api.stopDb().subscribe({
      next: (res) => {
        this.dbStatus.set(res.status);
        this.message.set(res.message);
        this.busy.set(false);
      },
      error: (err: { error?: { error?: string } }) => {
        this.message.set(err.error?.error || "Could not stop the database.");
        this.busy.set(false);
      },
    });
  }
}
