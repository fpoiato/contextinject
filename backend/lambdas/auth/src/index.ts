import {
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AdminUserGlobalSignOutCommand,
  AuthFlowType,
  ChallengeNameType,
  CognitoIdentityProviderClient,
  CodeMismatchException,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ExpiredCodeException,
  ForgotPasswordCommand,
  InvalidPasswordException,
  LimitExceededException,
  NotAuthorizedException,
  ResendConfirmationCodeCommand,
  RevokeTokenCommand,
  SignUpCommand,
  UserNotConfirmedException,
  UsernameExistsException,
  UserNotFoundException,
} from "@aws-sdk/client-cognito-identity-provider";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

const client = new CognitoIdentityProviderClient({});
const ALLOWED_ORIGINS = new Set(
  [process.env.ALLOWED_ORIGIN, "http://localhost:4200"].filter((value): value is string => Boolean(value)),
);

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

function corsHeaders(event: APIGatewayProxyEventV2): Record<string, string> {
  const origin = event.headers.origin || event.headers.Origin || "";
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : process.env.ALLOWED_ORIGIN || "*";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-headers": "content-type,authorization",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-max-age": "86400",
  };
}

function json(event: APIGatewayProxyEventV2, status: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders(event) },
    body: JSON.stringify(body),
  };
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> {
  if (!event.body) {
    return {};
  }
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function str(body: Record<string, unknown>, key: string): string {
  return String(body[key] ?? "").trim();
}

function requireEmail(body: Record<string, unknown>): string {
  const email = str(body, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "Enter a valid email address");
  }
  return email;
}

function requirePassword(body: Record<string, unknown>, key = "password"): string {
  const password = String(body[key] ?? "");
  if (password.length < 10) {
    throw new HttpError(400, "Password must be at least 10 characters");
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    throw new HttpError(400, "Password must include uppercase, lowercase and a number");
  }
  return password;
}

function pool() {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!userPoolId || !clientId) {
    throw new HttpError(500, "Authentication is not configured");
  }
  return { userPoolId, clientId };
}

function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) {
    return {};
  }
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

function sessionFromAuthResult(result: {
  AccessToken?: string;
  IdToken?: string;
  RefreshToken?: string;
  ExpiresIn?: number;
}) {
  const idToken = result.IdToken;
  if (!idToken || !result.AccessToken) {
    throw new HttpError(502, "Cognito did not return tokens");
  }
  const claims = decodeJwt(idToken);
  const groups = claims["cognito:groups"];
  return {
    idToken,
    accessToken: result.AccessToken,
    refreshToken: result.RefreshToken ?? null,
    expiresIn: result.ExpiresIn ?? 3600,
    sub: String(claims.sub ?? ""),
    email: String(claims.email ?? ""),
    groups: Array.isArray(groups) ? groups.map(String) : [],
  };
}

function mapCognitoError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof UserNotConfirmedException) {
    return new HttpError(403, "Confirm your email before signing in", "UNCONFIRMED");
  }
  if (error instanceof NotAuthorizedException || error instanceof UserNotFoundException) {
    return new HttpError(401, "Invalid email or password", "UNAUTHORIZED");
  }
  if (error instanceof UsernameExistsException) {
    return new HttpError(409, "An account with this email already exists", "EXISTS");
  }
  if (error instanceof CodeMismatchException) {
    return new HttpError(400, "That confirmation code is incorrect", "CODE");
  }
  if (error instanceof ExpiredCodeException) {
    return new HttpError(400, "That code has expired. Request a new one", "EXPIRED");
  }
  if (error instanceof InvalidPasswordException) {
    return new HttpError(400, "Password does not meet the requirements", "PASSWORD");
  }
  if (error instanceof LimitExceededException) {
    return new HttpError(429, "Too many attempts. Wait a minute and try again", "RATE");
  }
  const name = (error as { name?: string }).name;
  if (name === "InvalidParameterException") {
    return new HttpError(400, (error as Error).message || "Invalid request");
  }
  console.error("cognito auth error", error);
  return new HttpError(500, "Could not complete sign-in");
}

async function signup(body: Record<string, unknown>) {
  const { clientId } = pool();
  const email = requireEmail(body);
  const password = requirePassword(body);
  await client.send(
    new SignUpCommand({
      ClientId: clientId,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: "email", Value: email }],
    }),
  );
  return { ok: true, confirmationRequired: true, email };
}

async function confirm(body: Record<string, unknown>) {
  const { clientId } = pool();
  const email = requireEmail(body);
  const code = str(body, "code");
  if (!code) {
    throw new HttpError(400, "Enter the code from your email");
  }
  await client.send(new ConfirmSignUpCommand({ ClientId: clientId, Username: email, ConfirmationCode: code }));
  return { ok: true, email };
}

async function resend(body: Record<string, unknown>) {
  const { clientId } = pool();
  const email = requireEmail(body);
  await client.send(new ResendConfirmationCodeCommand({ ClientId: clientId, Username: email }));
  return { ok: true };
}

async function login(body: Record<string, unknown>) {
  const { userPoolId, clientId } = pool();
  const email = requireEmail(body);
  const password = String(body.password ?? "");
  if (!password) {
    throw new HttpError(400, "Enter your password");
  }
  const response = await client.send(
    new AdminInitiateAuthCommand({
      UserPoolId: userPoolId,
      ClientId: clientId,
      AuthFlow: AuthFlowType.ADMIN_USER_PASSWORD_AUTH,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  );
  if (response.ChallengeName === ChallengeNameType.NEW_PASSWORD_REQUIRED) {
    return {
      challenge: "NEW_PASSWORD_REQUIRED",
      session: response.Session,
      email,
    };
  }
  if (!response.AuthenticationResult) {
    throw new HttpError(401, "Could not sign in");
  }
  return sessionFromAuthResult(response.AuthenticationResult);
}

async function challenge(body: Record<string, unknown>) {
  const { userPoolId, clientId } = pool();
  const email = requireEmail(body);
  const session = str(body, "session");
  const newPassword = requirePassword(body, "newPassword");
  if (!session) {
    throw new HttpError(400, "Missing challenge session");
  }
  const response = await client.send(
    new AdminRespondToAuthChallengeCommand({
      UserPoolId: userPoolId,
      ClientId: clientId,
      ChallengeName: ChallengeNameType.NEW_PASSWORD_REQUIRED,
      Session: session,
      ChallengeResponses: { USERNAME: email, NEW_PASSWORD: newPassword },
    }),
  );
  if (!response.AuthenticationResult) {
    throw new HttpError(401, "Could not complete password update");
  }
  return sessionFromAuthResult(response.AuthenticationResult);
}

async function refresh(body: Record<string, unknown>) {
  const { userPoolId, clientId } = pool();
  const refreshToken = str(body, "refreshToken");
  if (!refreshToken) {
    throw new HttpError(401, "Session expired. Sign in again", "UNAUTHENTICATED");
  }
  const response = await client.send(
    new AdminInitiateAuthCommand({
      UserPoolId: userPoolId,
      ClientId: clientId,
      AuthFlow: AuthFlowType.REFRESH_TOKEN_AUTH,
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    }),
  );
  if (!response.AuthenticationResult) {
    throw new HttpError(401, "Session expired. Sign in again", "UNAUTHENTICATED");
  }
  const session = sessionFromAuthResult(response.AuthenticationResult);
  return { ...session, refreshToken: session.refreshToken || refreshToken };
}

async function forgot(body: Record<string, unknown>) {
  const { clientId } = pool();
  const email = requireEmail(body);
  try {
    await client.send(new ForgotPasswordCommand({ ClientId: clientId, Username: email }));
  } catch (error) {
    if (!(error instanceof UserNotFoundException) && !(error instanceof NotAuthorizedException)) {
      throw error;
    }
  }
  return { ok: true };
}

async function reset(body: Record<string, unknown>) {
  const { clientId } = pool();
  const email = requireEmail(body);
  const code = str(body, "code");
  const password = requirePassword(body);
  if (!code) {
    throw new HttpError(400, "Enter the code from your email");
  }
  await client.send(
    new ConfirmForgotPasswordCommand({
      ClientId: clientId,
      Username: email,
      ConfirmationCode: code,
      Password: password,
    }),
  );
  return { ok: true };
}

async function logout(body: Record<string, unknown>, event: APIGatewayProxyEventV2) {
  const { userPoolId, clientId } = pool();
  const refreshToken = str(body, "refreshToken");
  const accessToken = bearer(event) || str(body, "accessToken");
  if (refreshToken) {
    try {
      await client.send(new RevokeTokenCommand({ ClientId: clientId, Token: refreshToken }));
    } catch (error) {
      console.warn("revoke token", error);
    }
  }
  if (accessToken) {
    try {
      const claims = decodeJwt(accessToken);
      const username = String(claims["cognito:username"] || claims.email || "");
      if (username) {
        await client.send(new AdminUserGlobalSignOutCommand({ UserPoolId: userPoolId, Username: username }));
      }
    } catch (error) {
      console.warn("global sign out", error);
    }
  }
  return { ok: true };
}

function bearer(event: APIGatewayProxyEventV2): string {
  for (const [key, value] of Object.entries(event.headers)) {
    if (key.toLowerCase() === "authorization" && value) {
      const [scheme, token] = value.split(" ");
      if (scheme?.toLowerCase() === "bearer" && token) {
        return token.trim();
      }
    }
  }
  return "";
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method.toUpperCase();
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(event), body: "" };
  }
  if (method !== "POST") {
    return json(event, 405, { error: "Method not allowed" });
  }

  const path = (event.rawPath || "/").replace(/\/+$/, "") || "/";
  try {
    const body = parseBody(event);
    switch (path) {
      case "/auth/signup":
        return json(event, 201, await signup(body));
      case "/auth/confirm":
        return json(event, 200, await confirm(body));
      case "/auth/resend":
        return json(event, 200, await resend(body));
      case "/auth/login":
        return json(event, 200, await login(body));
      case "/auth/challenge":
        return json(event, 200, await challenge(body));
      case "/auth/refresh":
        return json(event, 200, await refresh(body));
      case "/auth/forgot":
        return json(event, 200, await forgot(body));
      case "/auth/reset":
        return json(event, 200, await reset(body));
      case "/auth/logout":
        return json(event, 200, await logout(body, event));
      default:
        return json(event, 404, { error: "Not found" });
    }
  } catch (error) {
    const mapped = mapCognitoError(error);
    return json(event, mapped.status, { error: mapped.message, code: mapped.code });
  }
}
