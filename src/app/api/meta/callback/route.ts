import { NextRequest, NextResponse } from "next/server";
import { getViewer, isStaff } from "@/lib/session";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import {
  exchangeCodeForLongLivedToken,
  inspectToken,
  listManagedPages,
  STATE_COOKIE,
} from "@/lib/meta/oauth";
import { channelsUrl, clearOAuthCookies, stateMatches } from "@/lib/oauth-state";
import { displayHandle, handleMatches, normalizeHandle, profileUrl } from "@/lib/handles";
import { graphRequest } from "@/lib/meta/graph";
import { saveAuthorizedSocialAccount } from "@/lib/owned-social-accounts";
import { Prisma } from "@prisma/client";

// Facebook redirects here after the admin approves access. For the Meta container's Facebook and
// Instagram social containers, it links only the Page / Instagram account matching each one's handle.
export async function GET(req: NextRequest) {
  const viewer = await getViewer();
  const done = (params: Record<string, string>) => {
    const res = NextResponse.redirect(channelsUrl(req, params, viewer));
    clearOAuthCookies(res, [STATE_COOKIE], "/api/meta");
    return res;
  };

  if (!viewer) return done({ error: "sign_in_required" });
  if (req.nextUrl.searchParams.get("error")) return done({ error: "cancelled" });
  if (!stateMatches(req, STATE_COOKIE, viewer)) return done({ error: "state_mismatch" });
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return done({ error: "no_code" });

  const ownerId = isStaff(viewer.role) ? null : viewer.id;
  const channels = await prisma.channel.findMany({ where: { ownerId, platform: { in: ["FACEBOOK", "INSTAGRAM"] } } });
  const fb = channels.find((c) => c.platform === "FACEBOOK" && (ownerId === null || c.handle));
  const ig = channels.find((c) => c.platform === "INSTAGRAM" && (ownerId === null || c.handle));
  if (!fb && !ig) return done({ error: "no_meta_channels" });

  try {
    const { access_token: userToken } = await exchangeCodeForLongLivedToken(code);
    if (ownerId) {
      const permissions = await graphRequest<{ data: { permission: string; status: string }[] }>("me/permissions", userToken);
      const granted = new Set(permissions.data.filter((p) => p.status === "granted").map((p) => p.permission));
      const needed = [
        "pages_show_list", "pages_read_engagement",
        ...(fb ? ["pages_manage_posts"] : []),
        ...(ig ? ["instagram_basic", "instagram_content_publish"] : []),
      ];
      if (needed.some((permission) => !granted.has(permission))) return done({ error: "provider_permissions_missing" });
    }
    const pages = fb || ig ? await listManagedPages(userToken) : [];
    if (pages.length === 0) return done({ error: "no_pages" });

    let saved = 0;
    const missing: string[] = [];
    if (fb) {
      const matches = pages.filter((p) =>
        (!ownerId || p.tasks?.some((task) => task === "CREATE_CONTENT" || task === "MANAGE"))
        && handleMatches("FACEBOOK", fb.handle, { handle: p.username ?? null, displayName: p.name, externalId: p.id }),
      );
      for (const page of matches) {
        const handle = page.username ? normalizeHandle("FACEBOOK", page.username) : null;
        const data = {
          displayName: page.name,
          accessTokenEncrypted: encrypt(page.access_token),
          tokenExpiresAt: null,
          disconnectedAt: null,
          handle,
          profileUrl: profileUrl("FACEBOOK", handle, page.id),
        };
        await saveAuthorizedSocialAccount("FACEBOOK", page.id, ownerId, data);
        saved++;
      }
      if (matches.length === 0) missing.push(`Facebook Page "${displayHandle("FACEBOOK", fb.handle)}"`);
    }
    if (ig) {
      const linked = pages.filter((p) => p.instagram_business_account && (!ownerId || p.tasks?.some((task) => task === "CREATE_CONTENT" || task === "MANAGE")));
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
          disconnectedAt: null,
          handle,
          profileUrl: profileUrl("INSTAGRAM", handle),
        };
        await saveAuthorizedSocialAccount("INSTAGRAM", a.id, ownerId, data);
        saved++;
      }
      if (matches.length === 0) missing.push(`Instagram account "${displayHandle("INSTAGRAM", ig.handle)}"`);
    }

    // Tell the admin what Facebook did share, so they can pick the right Page or number next time.
    const shared = [...pages
      .flatMap((p) => [p.name, p.instagram_business_account?.username ? `@${p.instagram_business_account.username}` : null])
      .filter(Boolean)]
      .join(", ");
    if (missing.length) {
      return done({ error: "handle_not_found", missing: missing.join(" and "), shared, ...(saved ? { connected: String(saved) } : {}) });
    }
    return done({ connected: String(saved), platform: "META" });
  } catch (err) {
    console.error("Meta connect failed:", err);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return done({ error: "account_already_connected" });
    return done({ error: "meta_error" });
  }
}
