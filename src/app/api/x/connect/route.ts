import { NextResponse } from "next/server";
import { getViewer } from "@/lib/session";
import { X_STATE_COOKIE, X_VERIFIER_COOKIE, xAuthorizeUrl, xConfigured } from "@/lib/x";
import { boundOAuthState, channelsUrl, pkceChallenge, randomToken, setOAuthCookie } from "@/lib/oauth-state";

// Starts "Add account" for the X container (OAuth 2.0 + PKCE). Admin only.
export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.redirect(new URL("/login", req.url));
  if (!xConfigured()) return NextResponse.redirect(channelsUrl(req, { error: "x_not_configured" }, viewer));

  const state = randomToken();
  const verifier = randomToken();
  const res = NextResponse.redirect(xAuthorizeUrl(state, pkceChallenge(verifier)));
  setOAuthCookie(res, X_STATE_COOKIE, boundOAuthState(state, viewer), "/api/x");
  setOAuthCookie(res, X_VERIFIER_COOKIE, verifier, "/api/x");
  return res;
}
