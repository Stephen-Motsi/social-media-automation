import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/session";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { TIKTOK_STATE_COOKIE, tiktokExchangeCode, tiktokGetUser } from "@/lib/tiktok";
import { channelsUrl, clearOAuthCookies, validatedOAuthScope } from "@/lib/oauth-state";
import { displayHandle, handleMatches, normalizeHandle, profileUrl } from "@/lib/handles";
import { saveAuthorizedSocialAccount } from "@/lib/owned-social-accounts";
import { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const viewer = await getViewer();
  const scope = viewer ? validatedOAuthScope(req, TIKTOK_STATE_COOKIE, viewer) : null;
  const done = (params: Record<string, string>) => {
    const res = NextResponse.redirect(channelsUrl(req, params, viewer, scope));
    clearOAuthCookies(res, [TIKTOK_STATE_COOKIE], "/api/tiktok");
    return res;
  };

  if (!viewer) return done({ error: "sign_in_required" });
  if (!scope) return done({ error: "state_mismatch" });
  if (req.nextUrl.searchParams.get("error")) return done({ error: "cancelled" });
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return done({ error: "no_code" });

  try {
    const tokens = await tiktokExchangeCode(code);
    if (scope === "personal" && !["user.info.basic", "user.info.profile", "video.publish"].every((permission) => tokens.scope?.split(/[,\s]+/).includes(permission))) {
      return done({ error: "provider_permissions_missing" });
    }
    const user = await tiktokGetUser(tokens.access_token);
    const ownerId = scope === "shared" ? null : viewer.id;
    const channel = await prisma.channel.findFirst({ where: { platform: "TIKTOK", ownerId } });
    if (ownerId && !channel?.handle) return done({ error: "handle_required", platform: "TIKTOK" });
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
      disconnectedAt: null,
    };
    await saveAuthorizedSocialAccount("TIKTOK", tokens.open_id, ownerId, data);
    return done({ connected: "1", platform: "TIKTOK" });
  } catch (err) {
    console.error("TikTok connect failed:", err);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return done({ error: "account_already_connected" });
    return done({ error: "tiktok_error" });
  }
}
