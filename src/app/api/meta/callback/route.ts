import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { exchangeCodeForLongLivedToken, listManagedPages, STATE_COOKIE } from "@/lib/meta/oauth";

// Facebook redirects here after the admin approves access.
// Saves each Page (FACEBOOK) and its linked Instagram business account (INSTAGRAM).
export async function GET(req: NextRequest) {
  const accounts = new URL("/accounts", process.env.AUTH_URL ?? req.url);
  const fail = (code: string) => {
    accounts.searchParams.set("error", code);
    const res = NextResponse.redirect(accounts);
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/meta" });
    return res;
  };

  const session = await auth();
  if (session?.user?.role !== "ADMIN") return fail("admin_only");

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return fail("cancelled"); // user pressed "Cancel" / denied

  const state = params.get("state") ?? "";
  const expected = req.cookies.get(STATE_COOKIE)?.value ?? "";
  if (!state || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
    return fail("state_mismatch");
  }
  const code = params.get("code");
  if (!code) return fail("no_code");

  try {
    const { access_token: userToken } = await exchangeCodeForLongLivedToken(code);
    const pages = await listManagedPages(userToken);
    if (pages.length === 0) return fail("no_pages");

    let saved = 0;
    for (const page of pages) {
      const token = encrypt(page.access_token);
      await prisma.socialAccount.upsert({
        where: { platform_externalId: { platform: "FACEBOOK", externalId: page.id } },
        update: { displayName: page.name, accessTokenEncrypted: token, tokenExpiresAt: null },
        create: { platform: "FACEBOOK", externalId: page.id, displayName: page.name, accessTokenEncrypted: token },
      });
      saved++;

      const ig = page.instagram_business_account;
      if (ig) {
        // Instagram publishing through Facebook Login uses the linked Page's token.
        const name = ig.username ? `@${ig.username}` : (ig.name ?? `Instagram ${ig.id}`);
        await prisma.socialAccount.upsert({
          where: { platform_externalId: { platform: "INSTAGRAM", externalId: ig.id } },
          update: { displayName: name, accessTokenEncrypted: token, tokenExpiresAt: null },
          create: { platform: "INSTAGRAM", externalId: ig.id, displayName: name, accessTokenEncrypted: token },
        });
        saved++;
      }
    }

    accounts.searchParams.set("connected", String(saved));
    const res = NextResponse.redirect(accounts);
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/meta" });
    return res;
  } catch (err) {
    console.error("Meta connect failed:", err);
    return fail("meta_error");
  }
}
