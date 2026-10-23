import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { loginUrl, metaConfigured, PLATFORM_COOKIE, STATE_COOKIE } from "@/lib/meta/oauth";
import { channelsUrl, randomToken, setOAuthCookie } from "@/lib/oauth-state";

// Starts "Add account" for the Facebook or Instagram container. Admin only.
export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return NextResponse.redirect(channelsUrl(req, { error: "admin_only" }));
  if (!metaConfigured()) return NextResponse.redirect(channelsUrl(req, { error: "meta_not_configured" }));

  const requested = new URL(req.url).searchParams.get("platform");
  const platform = requested === "INSTAGRAM" ? "INSTAGRAM" : "FACEBOOK";

  // CSRF protection: Facebook sends `state` back and we compare it with the cookie.
  const state = randomToken();
  const res = NextResponse.redirect(loginUrl(state));
  setOAuthCookie(res, STATE_COOKIE, state, "/api/meta");
  setOAuthCookie(res, PLATFORM_COOKIE, platform, "/api/meta");
  return res;
}
