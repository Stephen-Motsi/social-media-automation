import type { Platform } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { displayHandle, handleMatches, normalizeHandle, profileUrl } from "@/lib/handles";
import { reasonFor } from "@/lib/errors";
import { findWhatsAppNumber, inspectToken, listManagedPages, subscribeAppToWaba, getWhatsAppNumber } from "@/lib/meta/oauth";
import { GraphApiError } from "@/lib/meta/graph";
import { xGetMe, xOAuth1Token, xPortalKeysConfigured } from "@/lib/x";
import { tiktokConfigured, tiktokGetUser, tiktokRefresh } from "@/lib/tiktok";

// Connecting an account from its handle alone. Platforms only let an app post for an account the
// owner has authorised, so the business authorises once (credentials in .env); after that admins
// just type a Page, @handle or number and the backend finds that account and links it.
//   Facebook, Instagram, WhatsApp: META_SYSTEM_USER_TOKEN (a Business Settings system user with
//     access to the Pages, Instagram accounts and WhatsApp numbers). WHATSAPP_ACCESS_TOKEN also works.
//   X: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET (developer portal, "Keys and tokens").
//   TikTok: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET and TIKTOK_REFRESH_TOKEN (from one sign-in by the owner).

export type ConnectResult = { ok: true; message: string } | { ok: false; error: string };

const metaToken = () => process.env.META_SYSTEM_USER_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || "";

// Whether this platform can be connected from the handle, and if not, what to add to .env.
export function handleConnect(platform: Platform): { ready: boolean; setup: string } {
  switch (platform) {
    case "FACEBOOK":
    case "INSTAGRAM":
    case "WHATSAPP":
      return {
        ready: Boolean(metaToken()),
        setup: "add META_SYSTEM_USER_TOKEN to .env (Meta Business Settings → System users → Generate token, with access to your Pages, Instagram accounts and WhatsApp numbers)",
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
    handle: data.handle,
    profileUrl: profileUrl(platform, data.handle, externalId),
  };
  await prisma.socialAccount.upsert({
    where: { platform_externalId: { platform, externalId } },
    update: fields,
    create: { platform, externalId, ...fields },
  });
}

export async function connectByHandle(platform: Platform): Promise<ConnectResult> {
  const channel = await prisma.channel.findUnique({ where: { platform } });
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
      const token = metaToken();
      const wabaIds = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ? [process.env.WHATSAPP_BUSINESS_ACCOUNT_ID] : (await inspectToken(token)).wabaIds;
      const found = await findWhatsAppNumber(wabaIds, token, want);
      if (!found.number || !found.waba) {
        return { ok: false, error: `The Meta token doesn't include ${who}.${found.shared.length ? ` It has: ${found.shared.map((n) => n.display_phone_number).join(", ")}.` : ""} Give the system user access to the number in Business Settings, or check it.` };
      }
      const number = await getWhatsAppNumber(found.number.id, token);
      await subscribeAppToWaba(found.waba, token);
      const handle = normalizeHandle("WHATSAPP", number.display_phone_number);
      await save("WHATSAPP", number.id, { displayName: `${number.verified_name} (${number.display_phone_number})`, token, handle });
      return { ok: true, message: `Connected ${number.verified_name} (${number.display_phone_number}).` };
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
    const fresh = await tiktokRefresh(process.env.TIKTOK_REFRESH_TOKEN!);
    const user = await tiktokGetUser(fresh.access_token);
    if (!user.username || normalizeHandle("TIKTOK", user.username) !== normalizeHandle("TIKTOK", want)) {
      return { ok: false, error: `The TikTok token in .env is for ${user.username ? `@${user.username}` : user.display_name}, not ${who}.` };
    }
    await save("TIKTOK", user.open_id, {
      displayName: user.display_name,
      token: fresh.access_token,
      refreshToken: fresh.refresh_token,
      expiresAt: new Date(Date.now() + fresh.expires_in * 1000),
      handle: normalizeHandle("TIKTOK", user.username),
    });
    return { ok: true, message: `Connected @${user.username}.` };
  } catch (err) {
    const name = platform === "X" ? "X" : platform === "TIKTOK" ? "TikTok" : "Meta";
    return { ok: false, error: `${name} didn't accept the credentials in .env: ${err instanceof GraphApiError ? err.message : reasonFor(err)}` };
  }
}
