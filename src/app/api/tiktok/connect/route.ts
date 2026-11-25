import { NextResponse } from "next/server";
import { getViewer } from "@/lib/session";
import { TIKTOK_STATE_COOKIE, tiktokAuthorizeUrl, tiktokConfigured } from "@/lib/tiktok";
import { boundOAuthState, channelsUrl, randomToken, setOAuthCookie } from "@/lib/oauth-state";

// Starts "Add account" for the TikTok container. Admin only.
export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.redirect(new URL("/login", req.url));
  if (!tiktokConfigured()) return NextResponse.redirect(channelsUrl(req, { error: "tiktok_not_configured" }, viewer));

  const state = randomToken();
  const res = NextResponse.redirect(tiktokAuthorizeUrl(state));
  setOAuthCookie(res, TIKTOK_STATE_COOKIE, boundOAuthState(state, viewer), "/api/tiktok");
  return res;
}
