import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { exchangeCodeForLongLivedToken, listManagedPages, PLATFORM_COOKIE, STATE_COOKIE } from "@/lib/meta/oauth";
import { channelsUrl, clearOAuthCookies, stateMatches } from "@/lib/oauth-state";

// Facebook redirects here after the admin approves access.
// From the Facebook container this saves Pages; from the Instagram container, the Instagram
// business accounts linked to those Pages (published with the Page's token).
export async function GET(req: NextRequest) {
  const done = (params: Record<string, string>) => {
    const res = NextResponse.redirect(channelsUrl(req, params));
    clearOAuthCookies(res, [STATE_COOKIE, PLATFORM_COOKIE], "/api/meta");
    return res;
  };

  const session = await auth();
  if (session?.user?.role !== "ADMIN") return done({ error: "admin_only" });
  if (req.nextUrl.searchParams.get("error")) return done({ error: "cancelled" });
  if (!stateMatches(req, STATE_COOKIE)) return done({ error: "state_mismatch" });
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return done({ error: "no_code" });

  const platform = req.cookies.get(PLATFORM_COOKIE)?.value === "INSTAGRAM" ? "INSTAGRAM" : "FACEBOOK";

  try {
    const { access_token: userToken } = await exchangeCodeForLongLivedToken(code);
    const pages = await listManagedPages(userToken);
    if (pages.length === 0) return done({ error: "no_pages" });

    let saved = 0;
    for (const page of pages) {
      const token = encrypt(page.access_token);
      if (platform === "FACEBOOK") {
        await prisma.socialAccount.upsert({
          where: { platform_externalId: { platform: "FACEBOOK", externalId: page.id } },
          update: { displayName: page.name, accessTokenEncrypted: token, tokenExpiresAt: null },
          create: { platform: "FACEBOOK", externalId: page.id, displayName: page.name, accessTokenEncrypted: token },
        });
        saved++;
      } else if (page.instagram_business_account) {
        const ig = page.instagram_business_account;
        const name = ig.username ? `@${ig.username}` : (ig.name ?? `Instagram ${ig.id}`);
        await prisma.socialAccount.upsert({
          where: { platform_externalId: { platform: "INSTAGRAM", externalId: ig.id } },
          update: { displayName: name, accessTokenEncrypted: token, tokenExpiresAt: null },
          create: { platform: "INSTAGRAM", externalId: ig.id, displayName: name, accessTokenEncrypted: token },
        });
        saved++;
      }
    }
    if (saved === 0) return done({ error: "no_instagram" });
    return done({ connected: String(saved), platform });
  } catch (err) {
    console.error("Meta connect failed:", err);
    return done({ error: "meta_error" });
  }
}
