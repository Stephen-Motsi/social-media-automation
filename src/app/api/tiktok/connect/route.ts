import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { TIKTOK_STATE_COOKIE, tiktokAuthorizeUrl, tiktokConfigured } from "@/lib/tiktok";
import { channelsUrl, randomToken, setOAuthCookie } from "@/lib/oauth-state";

// Starts "Add account" for the TikTok container. Admin only.
export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return NextResponse.redirect(channelsUrl(req, { error: "admin_only" }));
  if (!tiktokConfigured()) return NextResponse.redirect(channelsUrl(req, { error: "tiktok_not_configured" }));

  const state = randomToken();
  const res = NextResponse.redirect(tiktokAuthorizeUrl(state));
  setOAuthCookie(res, TIKTOK_STATE_COOKIE, state, "/api/tiktok");
  return res;
}
