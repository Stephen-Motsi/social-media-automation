import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import type { Platform, Prisma } from "@prisma/client";
import { accessTokenFor, withTokenRefreshLock } from "@/lib/tokens";
import { graphRequest } from "@/lib/meta/graph";
import { xGetMe } from "@/lib/x";
import { tiktokGetUser } from "@/lib/tiktok";

type AuthorizedAccountData = {
  displayName: string;
  accessTokenEncrypted: string;
  handle: string | null;
  profileUrl: string | null;
  tokenExpiresAt: Date | null;
  disconnectedAt: null;
  refreshTokenEncrypted?: string | null;
};

export async function saveAuthorizedSocialAccount(platform: Platform, externalId: string, ownerId: string | null, data: AuthorizedAccountData) {
  if (platform !== "X" && platform !== "TIKTOK") {
    const updated = await prisma.socialAccount.updateMany({ where: { platform, externalId, ownerId }, data });
    if (!updated.count) await prisma.socialAccount.create({ data: { platform, externalId, ownerId, ...data } });
    return;
  }
  const save = async (tx: Prisma.TransactionClient) => {
    const updated = await tx.socialAccount.updateMany({ where: { platform, externalId, ownerId }, data });
    const account = updated.count
      ? await tx.socialAccount.findFirstOrThrow({ where: { platform, externalId, ownerId }, select: { id: true } })
      : await tx.socialAccount.create({ data: { platform, externalId, ownerId, ...data }, select: { id: true } });
    await tx.tokenRefreshAttempt.deleteMany({ where: { key: `account:${account.id}` } });
  };
  await withTokenRefreshLock(platform, save);
}

export async function listOwnedSocialAccounts(ownerId: string) {
  return prisma.socialAccount.findMany({
    where: { ownerId },
    select: { id: true, platform: true, displayName: true, handle: true, tokenExpiresAt: true, disconnectedAt: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function disconnectSocialAccounts(ownerId: string | null, ids: string[]) {
  const accounts = await prisma.socialAccount.findMany({
    where: { id: { in: ids }, ownerId, disconnectedAt: null },
    select: { id: true, platform: true },
  });
  let count = 0;
  for (const platform of new Set(accounts.map((account) => account.platform))) {
    const platformIds = accounts.filter((account) => account.platform === platform).map((account) => account.id);
    const disconnect = async (tx: Prisma.TransactionClient) => {
      const current = await tx.socialAccount.findMany({
        where: { id: { in: platformIds }, ownerId, platform, disconnectedAt: null },
        select: { id: true },
      });
      const currentIds = current.map((account) => account.id);
      const result = await tx.socialAccount.updateMany({
        where: { id: { in: currentIds }, ownerId, platform, disconnectedAt: null },
        data: { disconnectedAt: new Date(), accessTokenEncrypted: encrypt(""), refreshTokenEncrypted: null, tokenExpiresAt: null },
      });
      if (platform === "X" || platform === "TIKTOK") {
        await tx.tokenRefreshAttempt.deleteMany({ where: { key: { in: currentIds.map((id) => `account:${id}`) } } });
      }
      return result.count;
    };
    count += platform === "X" || platform === "TIKTOK"
      ? await withTokenRefreshLock(platform, disconnect)
      : await prisma.$transaction(disconnect);
  }
  return count;
}

export async function disconnectOwnedSocialAccount(ownerId: string, id: string) {
  return (await disconnectSocialAccounts(ownerId, [id])) === 1;
}

export async function verifyOwnedSocialAccount(ownerId: string, id: string) {
  const account = await prisma.socialAccount.findFirst({ where: { id, ownerId, disconnectedAt: null } });
  if (!account) throw new Error("Connected account not found.");
  const token = await accessTokenFor(account);
  if (account.platform === "X") {
    if ((await xGetMe(token)).id !== account.externalId) throw new Error("Account identity changed.");
  } else if (account.platform === "TIKTOK") {
    if ((await tiktokGetUser(token)).open_id !== account.externalId) throw new Error("Account identity changed.");
  } else if (account.platform === "FACEBOOK" || account.platform === "INSTAGRAM") {
    const response = await graphRequest<{ id: string }>(account.externalId, token, { query: { fields: "id" } });
    if (response.id !== account.externalId) throw new Error("Account identity changed.");
  } else {
    throw new Error("Use the WhatsApp connection status.");
  }
}
