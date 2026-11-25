import { NextResponse } from "next/server";
import { getViewer } from "@/lib/session";
import { loginUrl, metaConfigured, STATE_COOKIE } from "@/lib/meta/oauth";
import { boundOAuthState, channelsUrl, connectionScope, randomToken, setOAuthCookie } from "@/lib/oauth-state";

// Starts "Connect Meta accounts" for the Meta container: one Facebook login links the
// container's Facebook Page and Instagram account. Admin only.
export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.redirect(new URL("/login", req.url));
  const scope = connectionScope(viewer, new URL(req.url).searchParams.get("scope"));
  if (!scope) return new NextResponse("Invalid account scope", { status: 403 });
  if (!metaConfigured()) return NextResponse.redirect(channelsUrl(req, { error: "meta_not_configured" }, viewer, scope));

  // CSRF protection: Facebook sends `state` back and we compare it with the cookie.
  const state = randomToken();
  const res = NextResponse.redirect(loginUrl(state));
  setOAuthCookie(res, STATE_COOKIE, boundOAuthState(state, viewer, scope), "/api/meta");
  return res;
}
