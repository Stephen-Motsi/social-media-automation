import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import type { Platform } from "@prisma/client";
import { accessTokenFor } from "@/lib/tokens";
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
  const updated = await prisma.socialAccount.updateMany({ where: { platform, externalId, ownerId }, data });
  if (!updated.count) await prisma.socialAccount.create({ data: { platform, externalId, ownerId, ...data } });
}

export async function listOwnedSocialAccounts(ownerId: string) {
  return prisma.socialAccount.findMany({
    where: { ownerId },
    select: { id: true, platform: true, displayName: true, handle: true, tokenExpiresAt: true, disconnectedAt: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function disconnectOwnedSocialAccount(ownerId: string, id: string) {
  const result = await prisma.socialAccount.updateMany({
    where: { id, ownerId, disconnectedAt: null },
    data: { disconnectedAt: new Date(), accessTokenEncrypted: encrypt(""), refreshTokenEncrypted: null, tokenExpiresAt: null },
  });
  return result.count === 1;
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
