import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isStaff } from "@/lib/session";
import { loginUrl, metaConfigured, STATE_COOKIE } from "@/lib/meta/oauth";
import { channelsUrl, randomToken, setOAuthCookie } from "@/lib/oauth-state";

// Starts "Connect Meta accounts" for the Meta container: one Facebook login links the
// container's Facebook Page and Instagram account. Admin only.
export async function GET(req: Request) {
  const session = await auth();
  if (!isStaff(session?.user?.role)) return NextResponse.redirect(channelsUrl(req, { error: "admin_only" }));
  if (!metaConfigured()) return NextResponse.redirect(channelsUrl(req, { error: "meta_not_configured" }));

  // CSRF protection: Facebook sends `state` back and we compare it with the cookie.
  const state = randomToken();
  const res = NextResponse.redirect(loginUrl(state));
  setOAuthCookie(res, STATE_COOKIE, state, "/api/meta");
  return res;
}
