import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

// Short-lived cookies that carry OAuth state (CSRF) and PKCE verifiers between "connect" and "callback".

export const randomToken = () => randomBytes(32).toString("base64url");

export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export function setOAuthCookie(res: NextResponse, name: string, value: string, path: string) {
  res.cookies.set(name, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || (process.env.AUTH_URL ?? "").startsWith("https"),
    sameSite: "lax",
    path,
    maxAge: 600,
  });
}

export function clearOAuthCookies(res: NextResponse, names: string[], path: string) {
  for (const name of names) res.cookies.delete({ name, path });
}

export function stateMatches(req: NextRequest, cookieName: string) {
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const expected = req.cookies.get(cookieName)?.value ?? "";
  return state.length > 0 && state.length === expected.length && timingSafeEqual(Buffer.from(state), Buffer.from(expected));
}

export function channelsUrl(req: Request, params: Record<string, string> = {}) {
  const url = new URL("/channels", process.env.AUTH_URL ?? req.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}
