import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/session";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { X_STATE_COOKIE, X_VERIFIER_COOKIE, hasXPublishingScopes, xExchangeCode, xGetMe } from "@/lib/x";
import { channelsUrl, clearOAuthCookies, validatedOAuthScope } from "@/lib/oauth-state";
import { displayHandle, handleMatches, normalizeHandle, profileUrl } from "@/lib/handles";
import { saveAuthorizedSocialAccount } from "@/lib/owned-social-accounts";
import { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const viewer = await getViewer();
  const scope = viewer ? validatedOAuthScope(req, X_STATE_COOKIE, viewer) : null;
  const done = (params: Record<string, string>) => {
    const res = NextResponse.redirect(channelsUrl(req, params, viewer, scope));
    clearOAuthCookies(res, [X_STATE_COOKIE, X_VERIFIER_COOKIE], "/api/x");
    return res;
  };

  if (!viewer) return done({ error: "sign_in_required" });
  if (!scope) return done({ error: "state_mismatch" });
  if (req.nextUrl.searchParams.get("error")) return done({ error: "cancelled" });
  const code = req.nextUrl.searchParams.get("code");
  const verifier = req.cookies.get(X_VERIFIER_COOKIE)?.value;
  if (!code || !verifier) return done({ error: "no_code" });

  try {
    const tokens = await xExchangeCode(code, verifier);
    if (!hasXPublishingScopes(tokens.scope)) {
      return done({ error: "provider_permissions_missing" });
    }
    const me = await xGetMe(tokens.access_token);
    const handle = normalizeHandle("X", me.username);
    // Only link the account the X container's handle names.
    const ownerId = scope === "shared" ? null : viewer.id;
    const channel = await prisma.channel.findFirst({ where: { platform: "X", ownerId } });
    if (ownerId && !channel?.handle) return done({ error: "handle_required", platform: "X" });
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
      disconnectedAt: null,
    };
    await saveAuthorizedSocialAccount("X", me.id, ownerId, data);
    return done({ connected: "1", platform: "X" });
  } catch (err) {
    console.error("X connect failed:", err);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return done({ error: "account_already_connected" });
    return done({ error: "x_error" });
  }
}
