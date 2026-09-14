import { Injectable, computed, inject, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { ApiService, describeError, type DocumentItem, type Folder, type Me, type Project } from "./api.service";

const LAST_PROJECT_KEY = "easyrag.lastProject";

@Injectable({ providedIn: "root" })
export class WorkspaceStore {
  private readonly api = inject(ApiService);

  readonly me = signal<Me | null>(null);
  readonly projects = signal<Project[]>([]);
  readonly currentProjectId = signal<string | null>(null);
  readonly folders = signal<Folder[]>([]);
  readonly documents = signal<DocumentItem[]>([]);
  readonly currentFolderId = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal("");
  readonly dbStopped = signal(false);

  readonly currentProject = computed(() => this.projects().find((item) => item.id === this.currentProjectId()) ?? null);
  readonly currentFolder = computed(() => this.folders().find((item) => item.id === this.currentFolderId()) ?? null);
  readonly hasProcessing = computed(() => this.documents().some((item) => item.status === "pending" || item.status === "processing"));

  readonly usagePercent = computed(() => {
    const current = this.me();
    if (!current || !current.usage.limitBytes) {
      return 0;
    }
    return Math.min(100, Math.round((current.usage.bytes / current.usage.limitBytes) * 100));
  });

  /** Folder ids inside the current folder subtree (used to filter documents). */
  readonly scopedFolderIds = computed(() => {
    const root = this.currentFolderId();
    if (!root) {
      return null;
    }
    const ids = new Set<string>([root]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of this.folders()) {
        if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
          ids.add(folder.id);
          changed = true;
        }
      }
    }
    return ids;
  });

  readonly visibleDocuments = computed(() => {
    const scope = this.scopedFolderIds();
    const docs = this.documents();
    if (!scope) {
      return docs;
    }
    return docs.filter((doc) => doc.folderId && scope.has(doc.folderId));
  });

  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  async init(): Promise<void> {
    this.loading.set(true);
    this.error.set("");
    try {
      const [me, projects] = await Promise.all([firstValueFrom(this.api.me()), firstValueFrom(this.api.projects())]);
      this.me.set(me);
      this.dbStopped.set(false);
      this.projects.set(projects.projects);
      const remembered = localStorage.getItem(LAST_PROJECT_KEY);
      const initial = projects.projects.find((item) => item.id === remembered) ?? projects.projects[0] ?? null;
      if (initial) {
        await this.selectProject(initial.id);
      } else {
        this.currentProjectId.set(null);
        this.folders.set([]);
        this.documents.set([]);
      }
    } catch (err) {
      this.handleError(err, "Could not load your workspace");
    } finally {
      this.loading.set(false);
    }
  }

  async refreshMe(): Promise<void> {
    try {
      this.me.set(await firstValueFrom(this.api.me()));
    } catch {
      return;
    }
  }

  async refreshProjects(): Promise<void> {
    const response = await firstValueFrom(this.api.projects());
    this.projects.set(response.projects);
  }

  async selectProject(projectId: string): Promise<void> {
    this.currentProjectId.set(projectId);
    this.currentFolderId.set(null);
    localStorage.setItem(LAST_PROJECT_KEY, projectId);
    await this.refreshTree();
  }

  selectFolder(folderId: string | null): void {
    this.currentFolderId.set(folderId);
  }

  async refreshTree(): Promise<void> {
    const projectId = this.currentProjectId();
    if (!projectId) {
      return;
    }
    try {
      const tree = await firstValueFrom(this.api.tree(projectId));
      if (this.currentProjectId() !== projectId) {
        return;
      }
      this.folders.set(tree.folders);
      this.documents.set(tree.documents);
      this.dbStopped.set(false);
      this.schedulePoll();
    } catch (err) {
      this.handleError(err, "Could not load documents");
    }
  }

  private schedulePoll(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.hasProcessing()) {
      this.pollTimer = setTimeout(() => {
        this.pollTimer = null;
        void this.refreshTree();
        void this.refreshMe();
      }, 4000);
    }
  }

  async createProject(name: string): Promise<Project> {
    const project = await firstValueFrom(this.api.createProject(name));
    await this.refreshProjects();
    await this.selectProject(project.id);
    return project;
  }

  async renameProject(id: string, name: string): Promise<void> {
    await firstValueFrom(this.api.renameProject(id, name));
    await this.refreshProjects();
  }

  async deleteProject(id: string): Promise<void> {
    await firstValueFrom(this.api.deleteProject(id));
    await this.refreshProjects();
    await this.refreshMe();
    const next = this.projects()[0];
    if (next) {
      await this.selectProject(next.id);
    } else {
      this.currentProjectId.set(null);
      this.folders.set([]);
      this.documents.set([]);
    }
  }

  async createFolder(name: string, parentId: string | null): Promise<void> {
    const projectId = this.currentProjectId();
    if (!projectId) {
      return;
    }
    await firstValueFrom(this.api.createFolder(projectId, name, parentId));
    await this.refreshTree();
  }

  async renameFolder(id: string, name: string): Promise<void> {
    await firstValueFrom(this.api.updateFolder(id, { name }));
    await this.refreshTree();
  }

  async moveFolder(id: string, parentId: string | null): Promise<void> {
    await firstValueFrom(this.api.updateFolder(id, { parentId }));
    await this.refreshTree();
  }

  async deleteFolder(id: string): Promise<void> {
    await firstValueFrom(this.api.deleteFolder(id));
    if (this.currentFolderId() === id) {
      this.currentFolderId.set(null);
    }
    await this.refreshTree();
    await this.refreshMe();
    await this.refreshProjects();
  }

  async upload(files: File[]): Promise<string[]> {
    const projectId = this.currentProjectId();
    if (!projectId) {
      return ["Create a project before uploading."];
    }
    const failures: string[] = [];
    for (const file of files) {
      try {
        await this.api.uploadFile(projectId, this.currentFolderId(), file);
      } catch (err) {
        failures.push(`${file.name}: ${describeError(err, "upload failed")}`);
      }
    }
    await this.refreshTree();
    await this.refreshProjects();
    await this.refreshMe();
    return failures;
  }

  async renameDocument(id: string, filename: string): Promise<void> {
    await firstValueFrom(this.api.updateDocument(id, { filename }));
    await this.refreshTree();
  }

  async moveDocument(id: string, folderId: string | null): Promise<void> {
    await firstValueFrom(this.api.updateDocument(id, { folderId }));
    await this.refreshTree();
  }

  async deleteDocument(id: string): Promise<void> {
    await firstValueFrom(this.api.deleteDocument(id));
    await this.refreshTree();
    await this.refreshProjects();
    await this.refreshMe();
  }

  folderPath(folderId: string | null): Folder[] {
    const path: Folder[] = [];
    let cursor = folderId;
    let guard = 0;
    while (cursor && guard < 50) {
      const folder = this.folders().find((item) => item.id === cursor);
      if (!folder) break;
      path.unshift(folder);
      cursor = folder.parentId;
      guard += 1;
    }
    return path;
  }

  private handleError(err: unknown, fallback: string): void {
    const body = (err as { error?: { code?: string } })?.error;
    if (body && typeof body === "object" && body.code === "DB_STOPPED") {
      this.dbStopped.set(true);
    }
    this.error.set(describeError(err, fallback));
  }
}
