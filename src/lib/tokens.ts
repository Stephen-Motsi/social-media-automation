import type { Prisma, SocialAccount } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { xRefresh } from "@/lib/x";
import { tiktokRefresh } from "@/lib/tiktok";

const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const LOCK_WAIT_MS = 45_000;

class RefreshLockBusy extends Error {}

export async function withTokenRefreshLock<T>(platform: "X" | "TIKTOK", operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      return await prisma.$transaction(async (tx) => {
        const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtext('social-account-token-refresh'), hashtext(${platform})) AS "acquired"
        `;
        if (!lock?.acquired) throw new RefreshLockBusy();
        return operation(tx);
      }, { maxWait: 10_000, timeout: 65_000 });
    } catch (error) {
      if (!(error instanceof RefreshLockBusy)) throw error;
      if (Date.now() >= deadline) throw new Error("Social account token refresh is busy. Please retry.");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

function usableToken(account: SocialAccount) {
  if (account.disconnectedAt) throw new Error("This social account is disconnected. Reconnect it before publishing.");
  if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= Date.now() && !account.refreshTokenEncrypted) {
    throw new Error("This social account's authorization expired. Reconnect it before publishing.");
  }
  return decrypt(account.accessTokenEncrypted);
}

function needsRefresh(account: SocialAccount) {
  return (account.platform === "X" || account.platform === "TIKTOK")
    && Boolean(account.refreshTokenEncrypted && account.tokenExpiresAt && account.tokenExpiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS);
}

type RefreshResult = { access_token: string; refresh_token?: string; expires_in?: number };

async function journalRefresh(
  tx: Prisma.TransactionClient,
  key: string,
  previousAccessToken: string | null,
  previousRefreshToken: string | null,
  refresh: () => Promise<RefreshResult>,
) {
  let attempt = await tx.tokenRefreshAttempt.findUnique({ where: { key } });
  if (!attempt) {
    const generation = randomUUID();
    await prisma.tokenRefreshAttempt.create({ data: { key, generation, previousAccessToken, previousRefreshToken } });
    const fresh = await refresh();
    if (!fresh.access_token) throw new Error("The provider returned no access token; reconnect the account.");
    const data = {
      accessTokenEncrypted: encrypt(fresh.access_token),
      refreshTokenEncrypted: fresh.refresh_token ? encrypt(fresh.refresh_token) : previousRefreshToken,
      tokenExpiresAt: fresh.expires_in ? new Date(Date.now() + fresh.expires_in * 1000) : null,
      completed: true,
    };
    for (let retry = 0; retry < 3; retry++) {
      try {
        const saved = await prisma.tokenRefreshAttempt.updateMany({ where: { key, generation }, data });
        if (!saved.count) throw new Error("The token refresh attempt was replaced during provider rotation.");
        attempt = await prisma.tokenRefreshAttempt.findUnique({ where: { key } });
        if (!attempt || attempt.generation !== generation) throw new Error("The token refresh attempt changed after saving.");
        break;
      } catch (error) {
        if (retry === 2) throw new Error("Could not save rotated credentials. Reconnect the account if recovery fails.", { cause: error });
        await new Promise((resolve) => setTimeout(resolve, 200 * (retry + 1)));
      }
    }
  }
  if (!attempt?.completed || !attempt.accessTokenEncrypted) {
    throw new Error("Token refresh outcome is unknown. Reconnect the account before trying again.");
  }
  if (attempt.previousAccessToken !== previousAccessToken || attempt.previousRefreshToken !== previousRefreshToken) {
    throw new Error("Token refresh journal does not match the account. Reconnect it before trying again.");
  }
  return attempt;
}

export async function refreshTikTokSeedWithinLock(tx: Prisma.TransactionClient, seed: string) {
  const key = `tiktok-seed:${createHash("sha256").update(seed).digest("hex")}`;
  const attempt = await journalRefresh(tx, key, null, null, () => tiktokRefresh(seed));
  return { key, generation: attempt.generation, accessToken: decrypt(attempt.accessTokenEncrypted!), refreshTokenEncrypted: attempt.refreshTokenEncrypted, expiresAt: attempt.tokenExpiresAt };
}

export async function accessTokenWithinRefreshLock(tx: Prisma.TransactionClient, id: string): Promise<string> {
  const account = await tx.socialAccount.findUniqueOrThrow({ where: { id } });
  const key = `account:${account.id}`;
  let pending = await tx.tokenRefreshAttempt.findUnique({ where: { key } });
  if (pending && (pending.previousAccessToken !== account.accessTokenEncrypted || pending.previousRefreshToken !== account.refreshTokenEncrypted)) {
    const deleted = await prisma.tokenRefreshAttempt.deleteMany({ where: { key, generation: pending.generation } });
    if (!deleted.count) throw new Error("The token refresh journal changed. Retry the account operation.");
    pending = null;
  }
  const current = usableToken(account);
  if (!pending && (!needsRefresh(account) || !account.refreshTokenEncrypted)) return current;

  if (!account.refreshTokenEncrypted || (account.platform !== "X" && account.platform !== "TIKTOK")) {
    throw new Error("Token refresh cannot be recovered. Reconnect the account.");
  }
  const attempt = await journalRefresh(tx, key, account.accessTokenEncrypted, account.refreshTokenEncrypted, () => {
    const refreshToken = decrypt(account.refreshTokenEncrypted!);
    return account.platform === "X" ? xRefresh(refreshToken) : tiktokRefresh(refreshToken);
  });

  const updated = await tx.socialAccount.updateMany({
    where: {
      id: account.id, disconnectedAt: null, accessTokenEncrypted: account.accessTokenEncrypted,
      refreshTokenEncrypted: account.refreshTokenEncrypted, tokenExpiresAt: account.tokenExpiresAt,
    },
    data: {
      accessTokenEncrypted: attempt.accessTokenEncrypted!,
      refreshTokenEncrypted: attempt.refreshTokenEncrypted,
      tokenExpiresAt: attempt.tokenExpiresAt,
    },
  });
  if (!updated.count) throw new Error("The social account changed while its token was refreshing. Check its connection and retry.");
  const removed = await tx.tokenRefreshAttempt.deleteMany({ where: { key, generation: attempt.generation } });
  if (!removed.count) throw new Error("The token refresh journal changed while saving credentials.");
  return decrypt(attempt.accessTokenEncrypted!);
}

// Provider refreshes are serialized across processes; credential changes are checked before saving.
export async function accessTokenFor(account: SocialAccount): Promise<string> {
  const current = await prisma.socialAccount.findUniqueOrThrow({ where: { id: account.id } });
  const token = usableToken(current);
  if (current.platform !== "X" && current.platform !== "TIKTOK") return token;
  const pending = await prisma.tokenRefreshAttempt.findUnique({ where: { key: `account:${current.id}` } });
  if (!pending && !needsRefresh(current)) return token;
  return withTokenRefreshLock(current.platform, (tx) => accessTokenWithinRefreshLock(tx, current.id));
}
