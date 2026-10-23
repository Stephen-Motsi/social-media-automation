import type { SocialAccount } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { xRefresh } from "@/lib/x";
import { tiktokRefresh } from "@/lib/tiktok";

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

// Returns a usable access token, refreshing X/TikTok tokens that are about to expire.
// Meta Page tokens and WhatsApp system-user tokens don't expire, so they're returned as-is.
export async function accessTokenFor(account: SocialAccount): Promise<string> {
  const current = decrypt(account.accessTokenEncrypted);
  const expiresSoon = account.tokenExpiresAt && account.tokenExpiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;
  if (!expiresSoon || !account.refreshTokenEncrypted) return current;

  const refreshToken = decrypt(account.refreshTokenEncrypted);
  const fresh =
    account.platform === "X"
      ? await xRefresh(refreshToken)
      : account.platform === "TIKTOK"
        ? await tiktokRefresh(refreshToken)
        : null;
  if (!fresh) return current;

  await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEncrypted: encrypt(fresh.access_token),
      // X rotates refresh tokens on every use; TikTok may return the same one
      ...(fresh.refresh_token ? { refreshTokenEncrypted: encrypt(fresh.refresh_token) } : {}),
      tokenExpiresAt: fresh.expires_in ? new Date(Date.now() + fresh.expires_in * 1000) : null,
    },
  });
  return fresh.access_token;
}
