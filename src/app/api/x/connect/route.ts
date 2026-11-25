import { NextResponse } from "next/server";
import { getViewer } from "@/lib/session";
import { X_STATE_COOKIE, X_VERIFIER_COOKIE, xAuthorizeUrl, xConfigured } from "@/lib/x";
import { boundOAuthState, channelsUrl, connectionScope, pkceChallenge, randomToken, setOAuthCookie } from "@/lib/oauth-state";

// Starts "Add account" for the selected personal or shared X container.
export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.redirect(new URL("/login", req.url));
  const scope = connectionScope(viewer, new URL(req.url).searchParams.get("scope"));
  if (!scope) return new NextResponse("Invalid account scope", { status: 403 });
  if (!xConfigured()) return NextResponse.redirect(channelsUrl(req, { error: "x_not_configured" }, viewer, scope));

  const state = randomToken();
  const verifier = randomToken();
  const res = NextResponse.redirect(xAuthorizeUrl(state, pkceChallenge(verifier)));
  setOAuthCookie(res, X_STATE_COOKIE, boundOAuthState(state, viewer, scope), "/api/x");
  setOAuthCookie(res, X_VERIFIER_COOKIE, verifier, "/api/x");
  return res;
}
