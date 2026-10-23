import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { X_STATE_COOKIE, X_VERIFIER_COOKIE, xAuthorizeUrl, xConfigured } from "@/lib/x";
import { channelsUrl, pkceChallenge, randomToken, setOAuthCookie } from "@/lib/oauth-state";

// Starts "Add account" for the X container (OAuth 2.0 + PKCE). Admin only.
export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return NextResponse.redirect(channelsUrl(req, { error: "admin_only" }));
  if (!xConfigured()) return NextResponse.redirect(channelsUrl(req, { error: "x_not_configured" }));

  const state = randomToken();
  const verifier = randomToken();
  const res = NextResponse.redirect(xAuthorizeUrl(state, pkceChallenge(verifier)));
  setOAuthCookie(res, X_STATE_COOKIE, state, "/api/x");
  setOAuthCookie(res, X_VERIFIER_COOKIE, verifier, "/api/x");
  return res;
}
