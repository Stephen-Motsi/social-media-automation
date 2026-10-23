import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isStaff } from "@/lib/session";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { X_STATE_COOKIE, X_VERIFIER_COOKIE, xExchangeCode, xGetMe } from "@/lib/x";
import { channelsUrl, clearOAuthCookies, stateMatches } from "@/lib/oauth-state";
import { displayHandle, handleMatches, normalizeHandle, profileUrl } from "@/lib/handles";

export async function GET(req: NextRequest) {
  const done = (params: Record<string, string>) => {
    const res = NextResponse.redirect(channelsUrl(req, params));
    clearOAuthCookies(res, [X_STATE_COOKIE, X_VERIFIER_COOKIE], "/api/x");
    return res;
  };

  const session = await auth();
  if (!isStaff(session?.user?.role)) return done({ error: "admin_only" });
  if (req.nextUrl.searchParams.get("error")) return done({ error: "cancelled" });
  if (!stateMatches(req, X_STATE_COOKIE)) return done({ error: "state_mismatch" });
  const code = req.nextUrl.searchParams.get("code");
  const verifier = req.cookies.get(X_VERIFIER_COOKIE)?.value;
  if (!code || !verifier) return done({ error: "no_code" });

  try {
    const tokens = await xExchangeCode(code, verifier);
    const me = await xGetMe(tokens.access_token);
    const handle = normalizeHandle("X", me.username);
    // Only link the account the X container's handle names.
    const channel = await prisma.channel.findUnique({ where: { platform: "X" } });
    if (!handleMatches("X", channel?.handle, { handle, displayName: me.name, externalId: me.id })) {
      return done({ error: "handle_mismatch", expected: displayHandle("X", channel?.handle), got: `@${handle}`, platform: "X" });
    }
    const data = {
      displayName: `@${me.username}`,
      handle,
      profileUrl: profileUrl("X", handle),
      accessTokenEncrypted: encrypt(tokens.access_token),
      refreshTokenEncrypted: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
    };
    await prisma.socialAccount.upsert({
      where: { platform_externalId: { platform: "X", externalId: me.id } },
      update: data,
      create: { platform: "X", externalId: me.id, ...data },
    });
    return done({ connected: "1", platform: "X" });
  } catch (err) {
    console.error("X connect failed:", err);
    return done({ error: "x_error" });
  }
}
