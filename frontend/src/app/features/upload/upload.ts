import { Component, EventEmitter, Output, inject, signal } from "@angular/core";
import { ApiService, type DocumentItem } from "../../core/api.service";

@Component({
  selector: "app-upload",
  templateUrl: "./upload.html",
})
export class Upload {
  private readonly api = inject(ApiService);
  @Output() readonly changed = new EventEmitter<void>();

  readonly dragging = signal(false);
  readonly documents = signal<DocumentItem[]>([]);
  readonly status = signal("");
  readonly error = signal("");

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this.api.documents().subscribe({
      next: (res) => this.documents.set(res.documents),
      error: (err: { error?: { error?: string } }) => this.error.set(err.error?.error || "Could not list documents"),
    });
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  onDragLeave(): void {
    this.dragging.set(false);
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.dragging.set(false);
    const files = event.dataTransfer?.files;
    if (files?.length) {
      await this.uploadAll(Array.from(files));
    }
  }

  async onSelect(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      await this.uploadAll(Array.from(input.files));
      input.value = "";
    }
  }

  private async uploadAll(files: File[]): Promise<void> {
    this.error.set("");
    for (const file of files) {
      this.status.set(`Uploading ${file.name}...`);
      try {
        await this.api.uploadFile(file);
        this.status.set(`${file.name} sent for processing`);
        this.changed.emit();
      } catch (err) {
        this.error.set(err instanceof Error ? err.message : "Upload failed");
      }
    }
    this.refresh();
  }
}
