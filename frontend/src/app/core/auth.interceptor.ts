import { HttpErrorResponse, HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { from, switchMap, throwError, catchError } from "rxjs";
import { AuthService } from "./auth.service";
import { environment } from "./environment";

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(environment.apiUrl) || request.url.endsWith("/config")) {
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
        void auth.login(window.location.pathname);
      }
      return throwError(() => error);
    }),
  );
};
