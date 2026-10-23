import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { exchangeCodeForLongLivedToken, listManagedPages, STATE_COOKIE } from "@/lib/meta/oauth";
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
  if (session?.user?.role !== "ADMIN") return done({ error: "admin_only" });
  if (req.nextUrl.searchParams.get("error")) return done({ error: "cancelled" });
  if (!stateMatches(req, STATE_COOKIE)) return done({ error: "state_mismatch" });
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return done({ error: "no_code" });

  const channels = await prisma.channel.findMany({ where: { platform: { in: ["FACEBOOK", "INSTAGRAM"] } } });
  const fb = channels.find((c) => c.platform === "FACEBOOK");
  const ig = channels.find((c) => c.platform === "INSTAGRAM");
  if (!fb && !ig) return done({ error: "no_meta_channels" });

  try {
    const { access_token: userToken } = await exchangeCodeForLongLivedToken(code);
    const pages = await listManagedPages(userToken);
    if (pages.length === 0) return done({ error: "no_pages" });

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

    // Tell the admin what Facebook did share, so they can pick the right Page next time.
    const shared = pages
      .flatMap((p) => [p.name, p.instagram_business_account?.username ? `@${p.instagram_business_account.username}` : null])
      .filter(Boolean)
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
