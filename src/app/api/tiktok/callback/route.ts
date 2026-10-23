import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { TIKTOK_STATE_COOKIE, tiktokExchangeCode, tiktokGetUser } from "@/lib/tiktok";
import { channelsUrl, clearOAuthCookies, stateMatches } from "@/lib/oauth-state";

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
    const data = {
      displayName: user.display_name,
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
