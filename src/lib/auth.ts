import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

export const AUTH_COOKIE_NAME = "carrefour_app_auth";

export function isAuthEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD?.trim());
}

function getSigningSecret(): string {
  const customSecret = process.env.AUTH_SECRET?.trim();
  if (customSecret) return customSecret;
  const pwd = process.env.APP_PASSWORD?.trim() ?? "dev-fallback";
  return createHash("sha256")
    .update(`carrefour-tickets-secret:${pwd}`)
    .digest("hex");
}

function signPayload(payload: string): string {
  const secret = getSigningSecret();
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifySignedPayload(
  token: string | undefined | null,
  expectedPayload: string
): boolean {
  if (!isAuthEnabled()) return true;
  if (!token) return false;
  const expected = signPayload(expectedPayload);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createAuthToken(): string {
  return signPayload("authenticated");
}

export function createBookmarkletToken(): string {
  return signPayload("bookmarklet-sync");
}

export function verifyAuthToken(token: string | undefined | null): boolean {
  return verifySignedPayload(token, "authenticated");
}

export function verifyBookmarkletToken(token: string | undefined | null): boolean {
  return verifySignedPayload(token, "bookmarklet-sync");
}

export function verifyPassword(candidate: string): boolean {
  const expected = process.env.APP_PASSWORD?.trim();
  if (!expected) return true;
  const a = Buffer.from(candidate.trim());
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function isRequestAuthenticated(): Promise<boolean> {
  if (!isAuthEnabled()) return true;
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  return verifyAuthToken(token);
}

export function isApiRequestAuthenticated(request: NextRequest): boolean {
  if (!isAuthEnabled()) return true;
  const cookieToken = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (verifyAuthToken(cookieToken)) return true;
  const syncToken = request.headers.get("x-sync-token");
  if (verifyBookmarkletToken(syncToken)) return true;
  return false;
}
