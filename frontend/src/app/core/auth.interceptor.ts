import { HttpErrorResponse, HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { from, switchMap, throwError, catchError } from "rxjs";
import { AuthService } from "./auth.service";
import { environment } from "./environment";

function isPublicApi(url: string): boolean {
  return url.endsWith("/config") || url.endsWith("/health") || url.includes("/auth/");
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(environment.apiUrl) || isPublicApi(request.url)) {
    return next(request);
  }
  const auth = inject(AuthService);
  return from(auth.idToken()).pipe(
    switchMap((token) => {
      const authed = token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request;
      return next(authed);
    }),
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        auth.goToLogin(window.location.pathname);
      }
      return throwError(() => error);
    }),
  );
};
