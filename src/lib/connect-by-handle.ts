import type { Platform } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { displayHandle, handleMatches, normalizeHandle, profileUrl } from "@/lib/handles";
import { reasonFor } from "@/lib/errors";
import { findWhatsAppNumber, inspectToken, listManagedPages, subscribeAppToWaba, getWhatsAppNumber } from "@/lib/meta/oauth";
import { GraphApiError } from "@/lib/meta/graph";
import { xGetMe, xOAuth1Token, xPortalKeysConfigured } from "@/lib/x";
import { tiktokConfigured, tiktokGetUser } from "@/lib/tiktok";
import { accessTokenWithinRefreshLock, refreshTikTokSeedWithinLock, withTokenRefreshLock } from "@/lib/tokens";
import { saveAuthorizedSocialAccount } from "@/lib/owned-social-accounts";

// Connecting an account from its handle alone. Platforms only let an app post for an account the
// owner has authorised, so the business authorises once (credentials in .env); after that admins
// just type a Page, @handle or number and the backend finds that account and links it.
//   Facebook, Instagram: META_SYSTEM_USER_TOKEN (a Business Settings system user with
//     access to the Pages and Instagram accounts). WhatsApp uses per-user WAHA sessions.
//   X: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET (developer portal, "Keys and tokens").
//   TikTok: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET and TIKTOK_REFRESH_TOKEN (from one sign-in by the owner).

export type ConnectResult = { ok: true; message: string } | { ok: false; error: string };

const metaToken = () => process.env.META_SYSTEM_USER_TOKEN || "";

// Whether this platform can be connected from the handle, and if not, what to add to .env.
export function handleConnect(platform: Platform): { ready: boolean; setup: string } {
  switch (platform) {
    case "FACEBOOK":
    case "INSTAGRAM":
      return {
        ready: Boolean(metaToken()),
        setup: "add META_SYSTEM_USER_TOKEN to .env (Meta Business Settings → System users → Generate token, with access to your Pages, Instagram accounts and WhatsApp numbers)",
      };
    case "WHATSAPP":
      return {
        ready: false,
        setup: "use the WAHA QR connection workflow in Channels. WhatsApp Cloud credentials are not supported",
      };
    case "X":
      return {
        ready: xPortalKeysConfigured(),
        setup: "add X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN and X_ACCESS_TOKEN_SECRET to .env (X developer portal → your app → Keys and tokens, generated for the account you post from)",
      };
    case "TIKTOK":
      return {
        ready: tiktokConfigured() && Boolean(process.env.TIKTOK_REFRESH_TOKEN),
        setup: "add TIKTOK_REFRESH_TOKEN to .env (TikTok needs the account owner to sign in once; Connect below does that)",
      };
  }
}

async function save(platform: Platform, externalId: string, data: { displayName: string; token: string; handle: string | null; refreshToken?: string; expiresAt?: Date | null }) {
  const fields = {
    displayName: data.displayName,
    accessTokenEncrypted: encrypt(data.token),
    refreshTokenEncrypted: data.refreshToken ? encrypt(data.refreshToken) : null,
    tokenExpiresAt: data.expiresAt ?? null,
    disconnectedAt: null,
    handle: data.handle,
    profileUrl: profileUrl(platform, data.handle, externalId),
  };
  if (platform === "X") {
    await saveAuthorizedSocialAccount(platform, externalId, null, fields);
    return;
  }
  await prisma.socialAccount.upsert({
    where: { platform_externalId: { platform, externalId }, ownerId: null },
    update: fields,
    create: { platform, externalId, ...fields },
  });
}

export async function connectByHandle(platform: Platform): Promise<ConnectResult> {
  const channel = await prisma.channel.findFirst({ where: { platform, ownerId: null } });
  if (!channel?.handle) return { ok: false, error: "Enter the handle first." };
  const want = channel.handle;
  const who = displayHandle(platform, want);
  const setup = handleConnect(platform);
  if (!setup.ready) return { ok: false, error: `To connect ${who} from its handle, ${setup.setup}.` };

  try {
    if (platform === "FACEBOOK" || platform === "INSTAGRAM") {
      const pages = await listManagedPages(metaToken());
      if (platform === "FACEBOOK") {
        const page = pages.find((p) => handleMatches("FACEBOOK", want, { handle: p.username ?? null, displayName: p.name, externalId: p.id }));
        if (!page) return { ok: false, error: `The Meta token doesn't include the Page ${who}.${pages.length ? ` It has: ${pages.map((p) => p.username ?? p.name).join(", ")}.` : ""} Give the system user access to the Page in Business Settings, or check the handle.` };
        const handle = page.username ? normalizeHandle("FACEBOOK", page.username) : null;
        await save("FACEBOOK", page.id, { displayName: page.name, token: page.access_token, handle });
        return { ok: true, message: `Connected ${page.name}.` };
      }
      const page = pages.find((p) => p.instagram_business_account && handleMatches("INSTAGRAM", want, { handle: p.instagram_business_account.username ?? null, displayName: p.instagram_business_account.name ?? "", externalId: p.instagram_business_account.id }));
      if (!page) {
        const igs = pages.flatMap((p) => (p.instagram_business_account?.username ? [`@${p.instagram_business_account.username}`] : []));
        return { ok: false, error: `The Meta token doesn't include the Instagram account ${who}.${igs.length ? ` It has: ${igs.join(", ")}.` : ""} It must be a professional account linked to a Page the system user can access.` };
      }
      const ig = page.instagram_business_account!;
      const handle = ig.username ? normalizeHandle("INSTAGRAM", ig.username) : null;
      // Instagram publishing uses the linked Page's token.
      await save("INSTAGRAM", ig.id, { displayName: handle ? `@${handle}` : (ig.name ?? `Instagram ${ig.id}`), token: page.access_token, handle });
      return { ok: true, message: `Connected ${handle ? `@${handle}` : "the Instagram account"}.` };
    }

    if (platform === "WHATSAPP") {
      return { ok: false, error: "Use the WAHA QR connection workflow in Channels instead of WhatsApp Cloud credentials." };
    }

    if (platform === "X") {
      const token = xOAuth1Token(process.env.X_ACCESS_TOKEN!, process.env.X_ACCESS_TOKEN_SECRET!);
      const me = await xGetMe(token);
      if (normalizeHandle("X", me.username) !== normalizeHandle("X", want)) {
        return { ok: false, error: `The X keys in .env are for @${me.username}, not ${who}. Generate them while signed in as ${who}, or change the handle.` };
      }
      await save("X", me.id, { displayName: me.name, token, handle: normalizeHandle("X", me.username) });
      return { ok: true, message: `Connected @${me.username}.` };
    }

    // TikTok
    return await withTokenRefreshLock("TIKTOK", async (tx): Promise<ConnectResult> => {
      const accounts = await tx.socialAccount.findMany({ where: { platform: "TIKTOK", disconnectedAt: null } });
      const seed = process.env.TIKTOK_REFRESH_TOKEN!;
      const matchingSeed = accounts.find((account) => account.refreshTokenEncrypted && decrypt(account.refreshTokenEncrypted) === seed);
      if (matchingSeed?.ownerId) return { ok: false, error: "The configured TikTok credentials belong to a personal account." };
      const existing = accounts.find((account) => account.ownerId === null && account.handle && normalizeHandle("TIKTOK", account.handle) === normalizeHandle("TIKTOK", want)) ?? matchingSeed;
      if (existing) {
        const token = await accessTokenWithinRefreshLock(tx, existing.id);
        // Commit a rotated token even if the subsequent identity lookup fails.
        try {
          const user = await tiktokGetUser(token);
          if (user.open_id !== existing.externalId || !user.username || normalizeHandle("TIKTOK", user.username) !== normalizeHandle("TIKTOK", want)) {
            return { ok: false, error: `The connected TikTok identity does not match ${who}.` };
          }
          return { ok: true, message: `Connected @${user.username}.` };
        } catch (error) {
          return { ok: false, error: `TikTok identity verification failed: ${reasonFor(error)}` };
        }
      }
      const fresh = await refreshTikTokSeedWithinLock(tx, seed);
      const user = await tiktokGetUser(fresh.accessToken);
      if (!user.username || normalizeHandle("TIKTOK", user.username) !== normalizeHandle("TIKTOK", want)) {
        return { ok: false, error: `The TikTok token in .env is for ${user.username ? `@${user.username}` : user.display_name}, not ${who}.` };
      }
      const previous = await tx.socialAccount.findUnique({ where: { platform_externalId: { platform: "TIKTOK", externalId: user.open_id } } });
      if (previous && (previous.ownerId !== null || previous.disconnectedAt === null)) {
        return { ok: false, error: "This TikTok account is already connected. Reauthorize it if its credentials have changed." };
      }
      const fields = {
        displayName: user.display_name,
        accessTokenEncrypted: encrypt(fresh.accessToken),
        refreshTokenEncrypted: fresh.refreshTokenEncrypted,
        tokenExpiresAt: fresh.expiresAt,
        disconnectedAt: null,
        handle: normalizeHandle("TIKTOK", user.username),
        profileUrl: profileUrl("TIKTOK", user.username, user.open_id),
      };
      if (previous) {
        const updated = await tx.socialAccount.updateMany({
          where: { id: previous.id, ownerId: null, disconnectedAt: previous.disconnectedAt, accessTokenEncrypted: previous.accessTokenEncrypted, refreshTokenEncrypted: previous.refreshTokenEncrypted },
          data: fields,
        });
        if (!updated.count) throw new Error("The TikTok account changed during connection. Please retry.");
      } else {
        await tx.socialAccount.create({ data: { platform: "TIKTOK", externalId: user.open_id, ownerId: null, ...fields } });
      }
      const removed = await tx.tokenRefreshAttempt.deleteMany({ where: { key: fresh.key, generation: fresh.generation } });
      if (!removed.count) throw new Error("The TikTok refresh journal changed during connection.");
      return { ok: true, message: `Connected @${user.username}.` };
    });
  } catch (err) {
    const name = platform === "X" ? "X" : platform === "TIKTOK" ? "TikTok" : "Meta";
    return { ok: false, error: `${name} didn't accept the credentials in .env: ${err instanceof GraphApiError ? err.message : reasonFor(err)}` };
  }
}
