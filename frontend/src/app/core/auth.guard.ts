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
  await auth.login(state.url || "/app");
  return false;
};
