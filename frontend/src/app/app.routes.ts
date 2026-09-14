import { Routes } from "@angular/router";
import { authGuard } from "./core/auth.guard";

export const routes: Routes = [
  {
    path: "",
    loadComponent: () => import("./features/public/public-shell").then((m) => m.PublicShell),
    children: [
      { path: "", loadComponent: () => import("./features/public/landing").then((m) => m.Landing), title: "easyRAG — chat with your documents" },
      { path: "pricing", loadComponent: () => import("./features/public/pricing").then((m) => m.Pricing), title: "Pricing — easyRAG" },
      { path: "faq", loadComponent: () => import("./features/public/faq").then((m) => m.Faq), title: "FAQ — easyRAG" },
      { path: "terms", loadComponent: () => import("./features/public/legal").then((m) => m.Terms), title: "Terms of Service — easyRAG" },
      { path: "privacy", loadComponent: () => import("./features/public/legal").then((m) => m.Privacy), title: "Privacy Policy — easyRAG" },
    ],
  },
  { path: "auth/callback", loadComponent: () => import("./features/auth/callback").then((m) => m.AuthCallback), title: "Signing in…" },
  {
    path: "app",
    canActivate: [authGuard],
    loadComponent: () => import("./features/workspace/workspace").then((m) => m.Workspace),
    title: "Workspace — easyRAG",
  },
  { path: "**", redirectTo: "" },
];
