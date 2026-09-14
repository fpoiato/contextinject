import { Component, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { WorkspaceStore } from "../../core/workspace.store";
import { Account } from "../account/account";
import { Chat } from "../chat/chat";
import { Sidebar } from "./sidebar";

@Component({
  selector: "app-workspace",
  imports: [RouterLink, Sidebar, Chat, Account],
  templateUrl: "./workspace.html",
})
export class Workspace {
  readonly store = inject(WorkspaceStore);
  readonly auth = inject(AuthService);
  readonly sidebarOpen = signal(false);
  readonly accountOpen = signal(false);

  constructor() {
    void this.store.init();
  }

  logout(): void {
    void this.auth.logout();
  }
}
