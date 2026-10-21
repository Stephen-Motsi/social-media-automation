import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { loginUrl, metaConfigured, STATE_COOKIE } from "@/lib/meta/oauth";

// Starts "Connect with Facebook". Admin only.
export async function GET(req: Request) {
  const session = await auth();
  const accounts = new URL("/accounts", process.env.AUTH_URL ?? req.url);
  if (session?.user?.role !== "ADMIN") {
    accounts.searchParams.set("error", "admin_only");
    return NextResponse.redirect(accounts);
  }
  if (!metaConfigured()) {
    accounts.searchParams.set("error", "not_configured");
    return NextResponse.redirect(accounts);
  }

  // CSRF protection: Facebook sends this back and we compare it with the cookie.
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(loginUrl(state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || (process.env.AUTH_URL ?? "").startsWith("https"),
    sameSite: "lax",
    path: "/api/meta",
    maxAge: 600,
  });
  return res;
}
