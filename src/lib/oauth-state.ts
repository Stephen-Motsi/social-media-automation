import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import type { Viewer } from "@/lib/session";
import { isStaffRole } from "@/lib/ownership";

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

export function boundOAuthState(state: string, viewer: Pick<Viewer, "id" | "sessionId" | "role">) {
  const binding = createHmac("sha256", state).update(JSON.stringify([viewer.id, viewer.sessionId, viewer.role])).digest("base64url");
  return `${state}.${binding}`;
}

export function stateMatches(req: NextRequest, cookieName: string, viewer: Pick<Viewer, "id" | "sessionId" | "role">) {
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const expected = req.cookies.get(cookieName)?.value ?? "";
  if (!state) return false;
  const actual = boundOAuthState(state, viewer);
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function channelsUrl(req: Request, params: Record<string, string> = {}, viewer?: Pick<Viewer, "role"> | null) {
  const url = new URL(viewer && !isStaffRole(viewer.role) ? "/me/accounts" : "/channels", process.env.AUTH_URL ?? req.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}
