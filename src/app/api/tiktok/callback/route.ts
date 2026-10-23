import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { TIKTOK_STATE_COOKIE, tiktokExchangeCode, tiktokGetUser } from "@/lib/tiktok";
import { channelsUrl, clearOAuthCookies, stateMatches } from "@/lib/oauth-state";
import { displayHandle, handleMatches, normalizeHandle, profileUrl } from "@/lib/handles";

export async function GET(req: NextRequest) {
  const done = (params: Record<string, string>) => {
    const res = NextResponse.redirect(channelsUrl(req, params));
    clearOAuthCookies(res, [TIKTOK_STATE_COOKIE], "/api/tiktok");
    return res;
  };

  const session = await auth();
  if (session?.user?.role !== "ADMIN") return done({ error: "admin_only" });
  if (req.nextUrl.searchParams.get("error")) return done({ error: "cancelled" });
  if (!stateMatches(req, TIKTOK_STATE_COOKIE)) return done({ error: "state_mismatch" });
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return done({ error: "no_code" });

  try {
    const tokens = await tiktokExchangeCode(code);
    const user = await tiktokGetUser(tokens.access_token);
    const channel = await prisma.channel.findUnique({ where: { platform: "TIKTOK" } });
    const handle = user.username ? normalizeHandle("TIKTOK", user.username) : null;
    // Without the username we can't confirm it's the right account, so don't link it.
    if (channel?.handle && !handle) return done({ error: "tiktok_no_username" });
    if (!handleMatches("TIKTOK", channel?.handle, { handle, displayName: user.display_name, externalId: tokens.open_id })) {
      return done({ error: "handle_mismatch", expected: displayHandle("TIKTOK", channel?.handle), got: `@${handle}`, platform: "TIKTOK" });
    }
    const data = {
      displayName: handle ? `${user.display_name} (@${handle})` : user.display_name,
      handle,
      profileUrl: profileUrl("TIKTOK", handle),
      accessTokenEncrypted: encrypt(tokens.access_token),
      refreshTokenEncrypted: encrypt(tokens.refresh_token),
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    };
    await prisma.socialAccount.upsert({
      where: { platform_externalId: { platform: "TIKTOK", externalId: tokens.open_id } },
      update: data,
      create: { platform: "TIKTOK", externalId: tokens.open_id, ...data },
    });
    return done({ connected: "1", platform: "TIKTOK" });
  } catch (err) {
    console.error("TikTok connect failed:", err);
    return done({ error: "tiktok_error" });
  }
}
