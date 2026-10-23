import { graphRequest, graphVersion } from "./graph";

// Facebook Login for connecting Pages and their linked Instagram business accounts.
// Docs: https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
//       https://developers.facebook.com/docs/pages-api/getting-started
//       https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login

// Used when META_LOGIN_CONFIG_ID is not set (classic Facebook Login).
export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  // Lets Pages owned through a Business portfolio show up in /me/accounts
  "business_management",
];

export const STATE_COOKIE = "meta_oauth_state";
export const PLATFORM_COOKIE = "meta_oauth_platform";

export function metaConfigured() {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

export function redirectUri() {
  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/meta/callback`;
}

export function loginUrl(state: string) {
  // Overridable for local testing against a mock server.
  const dialogBase = (process.env.META_DIALOG_BASE_URL ?? "https://www.facebook.com").replace(/\/$/, "");
  const url = new URL(`${dialogBase}/${graphVersion()}/dialog/oauth`);
  url.searchParams.set("client_id", process.env.META_APP_ID!);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  // Facebook Login for Business uses a configuration ID instead of a scope list.
  if (process.env.META_LOGIN_CONFIG_ID) url.searchParams.set("config_id", process.env.META_LOGIN_CONFIG_ID);
  else url.searchParams.set("scope", META_SCOPES.join(","));
  return url.toString();
}

type TokenResponse = { access_token: string; token_type?: string; expires_in?: number };

export async function exchangeCodeForLongLivedToken(code: string) {
  const short = await graphRequest<TokenResponse>("oauth/access_token", null, {
    query: {
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      redirect_uri: redirectUri(),
      code,
    },
  });
  // Long-lived user token (~60 days). Page tokens fetched with it don't expire.
  return graphRequest<TokenResponse>("oauth/access_token", null, {
    query: {
      grant_type: "fb_exchange_token",
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      fb_exchange_token: short.access_token,
    },
  });
}

export type ManagedPage = {
  id: string;
  name: string;
  access_token: string;
  tasks?: string[];
  instagram_business_account?: { id: string; username?: string; name?: string };
};

export async function listManagedPages(userToken: string): Promise<ManagedPage[]> {
  const pages: ManagedPage[] = [];
  let after: string | undefined;
  do {
    const res = await graphRequest<{ data: ManagedPage[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      "me/accounts",
      userToken,
      {
        query: {
          fields: "id,name,access_token,tasks,instagram_business_account{id,username,name}",
          limit: "100",
          after,
        },
      },
    );
    pages.push(...res.data);
    after = res.paging?.next ? res.paging.cursors?.after : undefined;
  } while (after);
  return pages;
}

export async function getWhatsAppNumber(phoneNumberId: string, accessToken: string) {
  return graphRequest<{ id: string; display_phone_number: string; verified_name: string; quality_rating?: string }>(
    phoneNumberId,
    accessToken,
    { query: { fields: "id,display_phone_number,verified_name,quality_rating" } },
  );
}
