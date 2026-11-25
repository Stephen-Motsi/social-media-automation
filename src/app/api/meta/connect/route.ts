import { NextResponse } from "next/server";
import { getViewer } from "@/lib/session";
import { loginUrl, metaConfigured, STATE_COOKIE } from "@/lib/meta/oauth";
import { boundOAuthState, channelsUrl, randomToken, setOAuthCookie } from "@/lib/oauth-state";

// Starts "Connect Meta accounts" for the Meta container: one Facebook login links the
// container's Facebook Page and Instagram account. Admin only.
export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.redirect(new URL("/login", req.url));
  if (!metaConfigured()) return NextResponse.redirect(channelsUrl(req, { error: "meta_not_configured" }, viewer));

  // CSRF protection: Facebook sends `state` back and we compare it with the cookie.
  const state = randomToken();
  const res = NextResponse.redirect(loginUrl(state));
  setOAuthCookie(res, STATE_COOKIE, boundOAuthState(state, viewer), "/api/meta");
  return res;
}
