import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { AuthService } from "./auth.service";
import { ConfigService } from "./config.service";

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const config = inject(ConfigService);
  const router = inject(Router);
  if (!config.config()) {
    return router.createUrlTree(["/"], { queryParams: { error: "config" } });
  }
  await auth.restore();
  if (auth.isAuthenticated()) {
    return true;
  }
  return router.createUrlTree(["/login"], { queryParams: { returnTo: state.url || "/app" } });
};

export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.restore();
  if (auth.isAuthenticated()) {
    return router.createUrlTree(["/app"]);
  }
  return true;
};
