import { Component, EventEmitter, Output, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { describeError, type DocumentItem, type Folder } from "../../core/api.service";
import { formatBytes } from "../../core/format";
import { WorkspaceStore } from "../../core/workspace.store";

interface TreeRow {
  folder: Folder;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  documentCount: number;
}

@Component({
  selector: "app-sidebar",
  imports: [FormsModule],
  templateUrl: "./sidebar.html",
})
export class Sidebar {
  readonly store = inject(WorkspaceStore);
  @Output() readonly openAccount = new EventEmitter<void>();

  readonly bytes = formatBytes;
  readonly dragging = signal(false);
  readonly busy = signal(false);
  readonly notice = signal("");
  readonly noticeIsError = signal(false);
  readonly projectMenuOpen = signal(false);
  readonly expanded = signal<Set<string>>(new Set());
  readonly movingDocument = signal<string | null>(null);
  readonly movingFolder = signal<string | null>(null);

  readonly tree = computed<TreeRow[]>(() => {
    const folders = this.store.folders();
    const docs = this.store.documents();
    const expanded = this.expanded();
    const byParent = new Map<string | null, Folder[]>();
    for (const folder of folders) {
      const list = byParent.get(folder.parentId) ?? [];
      list.push(folder);
      byParent.set(folder.parentId, list);
    }
    const counts = new Map<string, number>();
    for (const doc of docs) {
      if (doc.folderId) {
        counts.set(doc.folderId, (counts.get(doc.folderId) ?? 0) + 1);
      }
    }
    const rows: TreeRow[] = [];
    const walk = (parentId: string | null, depth: number) => {
      const children = (byParent.get(parentId) ?? []).sort((a, b) => a.name.localeCompare(b.name));
      for (const folder of children) {
        const hasChildren = (byParent.get(folder.id)?.length ?? 0) > 0;
        const isExpanded = expanded.has(folder.id);
        rows.push({ folder, depth, hasChildren, expanded: isExpanded, documentCount: counts.get(folder.id) ?? 0 });
        if (hasChildren && isExpanded) {
          walk(folder.id, depth + 1);
        }
      }
    };
    walk(null, 0);
    return rows;
  });

  readonly rootDocumentCount = computed(() => this.store.documents().filter((doc) => !doc.folderId).length);

  readonly folderOptions = computed(() => {
    const rows: { id: string | null; label: string }[] = [{ id: null, label: "Project root" }];
    const byParent = new Map<string | null, Folder[]>();
    for (const folder of this.store.folders()) {
      const list = byParent.get(folder.parentId) ?? [];
      list.push(folder);
      byParent.set(folder.parentId, list);
    }
    const walk = (parentId: string | null, prefix: string) => {
      for (const folder of (byParent.get(parentId) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
        rows.push({ id: folder.id, label: `${prefix}${folder.name}` });
        walk(folder.id, `${prefix}${folder.name} / `);
      }
    };
    walk(null, "");
    return rows;
  });

  toggle(folderId: string): void {
    this.expanded.update((current) => {
      const next = new Set(current);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }

  selectFolder(folderId: string | null): void {
    this.store.selectFolder(folderId);
    if (folderId) {
      this.expanded.update((current) => new Set(current).add(folderId));
    }
  }

  async selectProject(event: Event): Promise<void> {
    const value = (event.target as HTMLSelectElement).value;
    if (value === "__new__") {
      await this.newProject();
      return;
    }
    if (value) {
      await this.store.selectProject(value);
    }
  }

  async newProject(): Promise<void> {
    const name = window.prompt("Project name");
    if (!name?.trim()) {
      return;
    }
    await this.run(() => this.store.createProject(name.trim()).then(() => undefined), `Project "${name.trim()}" created`);
  }

  async renameProject(): Promise<void> {
    const project = this.store.currentProject();
    if (!project) return;
    const name = window.prompt("Rename project", project.name);
    if (!name?.trim() || name.trim() === project.name) return;
    await this.run(() => this.store.renameProject(project.id, name.trim()), "Project renamed");
  }

  async deleteProject(): Promise<void> {
    const project = this.store.currentProject();
    if (!project) return;
    const ok = window.confirm(`Delete project "${project.name}" and all ${project.documentCount} documents? This cannot be undone.`);
    if (!ok) return;
    await this.run(() => this.store.deleteProject(project.id), "Project deleted");
  }

  async newFolder(parentId: string | null): Promise<void> {
    const name = window.prompt("Folder name");
    if (!name?.trim()) return;
    await this.run(() => this.store.createFolder(name.trim(), parentId), "Folder created");
    if (parentId) {
      this.expanded.update((current) => new Set(current).add(parentId));
    }
  }

  async renameFolder(folder: Folder): Promise<void> {
    const name = window.prompt("Rename folder", folder.name);
    if (!name?.trim() || name.trim() === folder.name) return;
    await this.run(() => this.store.renameFolder(folder.id, name.trim()), "Folder renamed");
  }

  async deleteFolder(folder: Folder): Promise<void> {
    const ok = window.confirm(`Delete folder "${folder.name}" including subfolders and their documents?`);
    if (!ok) return;
    await this.run(() => this.store.deleteFolder(folder.id), "Folder deleted");
  }

  async moveFolderTo(folder: Folder, event: Event): Promise<void> {
    const value = (event.target as HTMLSelectElement).value;
    this.movingFolder.set(null);
    const target = value === "" ? null : value;
    if (target === folder.parentId) return;
    await this.run(() => this.store.moveFolder(folder.id, target), "Folder moved");
  }

  async renameDocument(doc: DocumentItem): Promise<void> {
    const name = window.prompt("Rename document", doc.filename);
    if (!name?.trim() || name.trim() === doc.filename) return;
    await this.run(() => this.store.renameDocument(doc.id, name.trim()), "Document renamed");
  }

  async deleteDocument(doc: DocumentItem): Promise<void> {
    const ok = window.confirm(`Delete "${doc.filename}"?`);
    if (!ok) return;
    await this.run(() => this.store.deleteDocument(doc.id), "Document deleted");
  }

  async moveDocumentTo(doc: DocumentItem, event: Event): Promise<void> {
    const value = (event.target as HTMLSelectElement).value;
    this.movingDocument.set(null);
    const target = value === "" ? null : value;
    if (target === doc.folderId) return;
    await this.run(() => this.store.moveDocument(doc.id, target), "Document moved");
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
    if (!this.store.currentProjectId()) {
      this.show("Create a project before uploading.", true);
      return;
    }
    this.busy.set(true);
    this.show(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}…`, false);
    try {
      const failures = await this.store.upload(files);
      if (failures.length) {
        this.show(failures.join(" · "), true);
      } else {
        this.show("Upload complete — indexing in progress.", false);
      }
    } finally {
      this.busy.set(false);
    }
  }

  statusClass(status: string): string {
    switch (status) {
      case "ready":
        return "bg-emerald-500/15 text-emerald-300";
      case "error":
        return "bg-rose-500/15 text-rose-300";
      default:
        return "bg-amber-500/15 text-amber-200";
    }
  }

  private async run(action: () => Promise<void>, success: string): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      this.show(success, false);
    } catch (err) {
      this.show(describeError(err), true);
    } finally {
      this.busy.set(false);
    }
  }

  private show(message: string, isError: boolean): void {
    this.notice.set(message);
    this.noticeIsError.set(isError);
  }
}
