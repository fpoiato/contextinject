import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

export interface AuthContext {
  sub: string;
  email: string;
  groups: string[];
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;

function getVerifier() {
  if (!verifier) {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_CLIENT_ID;
    if (!userPoolId || !clientId) {
      throw new HttpError(500, "Authentication is not configured");
    }
    verifier = CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: "id" });
  }
  return verifier;
}

export function bearerToken(event: APIGatewayProxyEventV2): string | undefined {
  for (const [key, value] of Object.entries(event.headers)) {
    if (key.toLowerCase() === "authorization" && value) {
      const [scheme, token] = value.split(" ");
      if (scheme?.toLowerCase() === "bearer" && token) {
        return token.trim();
      }
    }
  }
  return undefined;
}

export async function authenticate(event: APIGatewayProxyEventV2): Promise<AuthContext> {
  const token = bearerToken(event);
  if (!token) {
    throw new HttpError(401, "Sign in to continue", "UNAUTHENTICATED");
  }
  try {
    const payload = await getVerifier().verify(token);
    const groups = payload["cognito:groups"];
    return {
      sub: String(payload.sub),
      email: String(payload["email"] ?? ""),
      groups: Array.isArray(groups) ? groups.map(String) : [],
    };
  } catch {
    throw new HttpError(401, "Session expired. Sign in again.", "UNAUTHENTICATED");
  }
}

export function requireAdmin(auth: AuthContext): void {
  if (!auth.groups.includes("admin")) {
    throw new HttpError(403, "Admin access required", "FORBIDDEN");
  }
}
