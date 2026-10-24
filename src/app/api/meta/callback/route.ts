import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isStaff } from "@/lib/session";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import {
  exchangeCodeForLongLivedToken,
  findWhatsAppNumber,
  inspectToken,
  listManagedPages,
  STATE_COOKIE,
  subscribeAppToWaba,
} from "@/lib/meta/oauth";
import { channelsUrl, clearOAuthCookies, stateMatches } from "@/lib/oauth-state";
import { displayHandle, handleMatches, normalizeHandle, profileUrl } from "@/lib/handles";

// Facebook redirects here after the admin approves access. For the Meta container's Facebook and
// Instagram social containers, it links only the Page / Instagram account matching each one's handle.
export async function GET(req: NextRequest) {
  const done = (params: Record<string, string>) => {
    const res = NextResponse.redirect(channelsUrl(req, params));
    clearOAuthCookies(res, [STATE_COOKIE], "/api/meta");
    return res;
  };

  const session = await auth();
  if (!isStaff(session?.user?.role)) return done({ error: "admin_only" });
  if (req.nextUrl.searchParams.get("error")) return done({ error: "cancelled" });
  if (!stateMatches(req, STATE_COOKIE)) return done({ error: "state_mismatch" });
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return done({ error: "no_code" });

  const channels = await prisma.channel.findMany({ where: { platform: { in: ["FACEBOOK", "INSTAGRAM", "WHATSAPP"] } } });
  const fb = channels.find((c) => c.platform === "FACEBOOK");
  const ig = channels.find((c) => c.platform === "INSTAGRAM");
  const wa = channels.find((c) => c.platform === "WHATSAPP");
  if (!fb && !ig && !wa) return done({ error: "no_meta_channels" });

  try {
    const { access_token: userToken } = await exchangeCodeForLongLivedToken(code);
    const pages = fb || ig ? await listManagedPages(userToken) : [];
    if ((fb || ig) && !wa && pages.length === 0) return done({ error: "no_pages" });

    let saved = 0;
    const missing: string[] = [];
    if (fb) {
      const matches = pages.filter((p) =>
        handleMatches("FACEBOOK", fb.handle, { handle: p.username ?? null, displayName: p.name, externalId: p.id }),
      );
      for (const page of matches) {
        const handle = page.username ? normalizeHandle("FACEBOOK", page.username) : null;
        const data = {
          displayName: page.name,
          accessTokenEncrypted: encrypt(page.access_token),
          tokenExpiresAt: null,
          handle,
          profileUrl: profileUrl("FACEBOOK", handle, page.id),
        };
        await prisma.socialAccount.upsert({
          where: { platform_externalId: { platform: "FACEBOOK", externalId: page.id } },
          update: data,
          create: { platform: "FACEBOOK", externalId: page.id, ...data },
        });
        saved++;
      }
      if (matches.length === 0) missing.push(`Facebook Page "${displayHandle("FACEBOOK", fb.handle)}"`);
    }
    if (ig) {
      const linked = pages.filter((p) => p.instagram_business_account);
      const matches = linked.filter((p) => {
        const a = p.instagram_business_account!;
        return handleMatches("INSTAGRAM", ig.handle, { handle: a.username ?? null, displayName: a.name ?? "", externalId: a.id });
      });
      for (const page of matches) {
        const a = page.instagram_business_account!;
        const handle = a.username ? normalizeHandle("INSTAGRAM", a.username) : null;
        // Instagram publishing through Facebook Login uses the linked Page's token.
        const data = {
          displayName: handle ? `@${handle}` : (a.name ?? `Instagram ${a.id}`),
          accessTokenEncrypted: encrypt(page.access_token),
          tokenExpiresAt: null,
          handle,
          profileUrl: profileUrl("INSTAGRAM", handle),
        };
        await prisma.socialAccount.upsert({
          where: { platform_externalId: { platform: "INSTAGRAM", externalId: a.id } },
          update: data,
          create: { platform: "INSTAGRAM", externalId: a.id, ...data },
        });
        saved++;
      }
      if (matches.length === 0) missing.push(`Instagram account "${displayHandle("INSTAGRAM", ig.handle)}"`);
    }

    // WhatsApp: the backend finds the typed number in the WhatsApp Business Accounts the admin shared,
    // and stores its phone number ID with this sign-in's token. Nothing to copy from Meta by hand.
    const sharedNumbers: string[] = [];
    if (wa?.handle) {
      const { wabaIds, expiresAt } = await inspectToken(userToken);
      const found = await findWhatsAppNumber(wabaIds, userToken, wa.handle);
      sharedNumbers.push(...found.shared.map((n) => n.display_phone_number));
      if (found.number && found.waba) {
        const handle = normalizeHandle("WHATSAPP", found.number.display_phone_number);
        const data = {
          displayName: `${found.number.verified_name} (${found.number.display_phone_number})`,
          accessTokenEncrypted: encrypt(userToken),
          tokenExpiresAt: expiresAt,
          handle,
          profileUrl: profileUrl("WHATSAPP", handle),
        };
        await prisma.socialAccount.upsert({
          where: { platform_externalId: { platform: "WHATSAPP", externalId: found.number.id } },
          update: data,
          create: { platform: "WHATSAPP", externalId: found.number.id, ...data },
        });
        await subscribeAppToWaba(found.waba, userToken);
        saved++;
      } else {
        missing.push(`WhatsApp number "${displayHandle("WHATSAPP", wa.handle)}"`);
      }
    }

    // Tell the admin what Facebook did share, so they can pick the right Page or number next time.
    const shared = [...pages
      .flatMap((p) => [p.name, p.instagram_business_account?.username ? `@${p.instagram_business_account.username}` : null])
      .filter(Boolean), ...sharedNumbers]
      .join(", ");
    if (missing.length) {
      return done({ error: "handle_not_found", missing: missing.join(" and "), shared, ...(saved ? { connected: String(saved) } : {}) });
    }
    return done({ connected: String(saved), platform: "META" });
  } catch (err) {
    console.error("Meta connect failed:", err);
    return done({ error: "meta_error" });
  }
}
