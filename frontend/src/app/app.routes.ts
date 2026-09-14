import { Routes } from "@angular/router";
import { authGuard, guestGuard } from "./core/auth.guard";

export const routes: Routes = [
  {
    path: "",
    loadComponent: () => import("./features/public/public-shell").then((m) => m.PublicShell),
    children: [
      { path: "", loadComponent: () => import("./features/public/landing").then((m) => m.Landing), title: "contextinject — chat with your documents" },
      { path: "pricing", loadComponent: () => import("./features/public/pricing").then((m) => m.Pricing), title: "Pricing — contextinject" },
      { path: "faq", loadComponent: () => import("./features/public/faq").then((m) => m.Faq), title: "FAQ — contextinject" },
      { path: "terms", loadComponent: () => import("./features/public/legal").then((m) => m.Terms), title: "Terms of Service — contextinject" },
      { path: "privacy", loadComponent: () => import("./features/public/legal").then((m) => m.Privacy), title: "Privacy Policy — contextinject" },
      { path: "login", canActivate: [guestGuard], loadComponent: () => import("./features/auth/login").then((m) => m.Login), title: "Sign in — contextinject" },
      { path: "signup", canActivate: [guestGuard], loadComponent: () => import("./features/auth/signup").then((m) => m.Signup), title: "Create account — contextinject" },
      { path: "verify", canActivate: [guestGuard], loadComponent: () => import("./features/auth/verify").then((m) => m.Verify), title: "Confirm email — contextinject" },
      { path: "forgot", canActivate: [guestGuard], loadComponent: () => import("./features/auth/forgot").then((m) => m.Forgot), title: "Reset password — contextinject" },
      { path: "reset", canActivate: [guestGuard], loadComponent: () => import("./features/auth/reset").then((m) => m.Reset), title: "New password — contextinject" },
    ],
  },
  { path: "auth/callback", redirectTo: "login" },
  {
    path: "app",
    canActivate: [authGuard],
    loadComponent: () => import("./features/workspace/workspace").then((m) => m.Workspace),
    title: "Workspace — contextinject",
  },
  { path: "**", redirectTo: "" },
];
