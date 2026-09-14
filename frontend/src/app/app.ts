import { Component, signal } from "@angular/core";
import { Chat } from "./features/chat/chat";
import { Upload } from "./features/upload/upload";
import { Settings } from "./features/settings/settings";

@Component({
  selector: "app-root",
  imports: [Chat, Upload, Settings],
  templateUrl: "./app.html",
  styleUrl: "./app.css",
})
export class App {
  readonly settingsOpen = signal(false);
}
