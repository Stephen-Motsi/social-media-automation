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
  // @mention subscribers in a comment on the advert's post
  "instagram_manage_comments",
  // Lets Pages owned through a Business portfolio show up in /me/accounts
  "business_management",
  // WhatsApp: find the shared WhatsApp Business Accounts and their phone numbers, and send messages
  "whatsapp_business_management",
  "whatsapp_business_messaging",
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
  username?: string;
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
          fields: "id,name,username,access_token,tasks,instagram_business_account{id,username,name}",
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

// ---- WhatsApp: everything the backend needs from one Facebook sign-in --------------------

export type WhatsAppNumber = { id: string; display_phone_number: string; verified_name: string; quality_rating?: string };

// The WhatsApp Business Accounts this token was granted (from the token's granular scopes),
// plus when the token expires (0 = never, e.g. a system-user token).
export async function inspectToken(token: string) {
  const appToken = `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`;
  const res = await graphRequest<{
    data: { expires_at?: number; granular_scopes?: { scope: string; target_ids?: string[] }[] };
  }>("debug_token", null, { query: { input_token: token, access_token: appToken } });
  const wabaIds = new Set<string>();
  for (const g of res.data.granular_scopes ?? []) {
    if (g.scope.startsWith("whatsapp_business")) for (const id of g.target_ids ?? []) wabaIds.add(id);
  }
  return { wabaIds: [...wabaIds], expiresAt: res.data.expires_at ? new Date(res.data.expires_at * 1000) : null };
}

export async function listWhatsAppNumbers(wabaId: string, token: string) {
  const res = await graphRequest<{ data: WhatsAppNumber[] }>(`${wabaId}/phone_numbers`, token, {
    query: { fields: "id,display_phone_number,verified_name,quality_rating" },
  });
  return res.data;
}

// So the app receives this account's messages (JOIN / MANAGE / STOP) and delivery statuses.
export async function subscribeAppToWaba(wabaId: string, token: string) {
  await graphRequest(`${wabaId}/subscribed_apps`, token, { method: "POST" }).catch((err) =>
    console.error("Subscribing to WhatsApp webhooks failed:", err instanceof Error ? err.message : err),
  );
}

// Finds a number across the given WhatsApp Business Accounts. `digits` is the number, digits only.
export async function findWhatsAppNumber(wabaIds: string[], token: string, digits: string) {
  const shared: WhatsAppNumber[] = [];
  for (const waba of wabaIds) {
    const numbers = await listWhatsAppNumbers(waba, token).catch(() => []);
    shared.push(...numbers);
    const match = numbers.find((n) => n.display_phone_number.replace(/\D/g, "") === digits);
    if (match) return { waba, number: match, shared };
  }
  return { waba: null, number: null, shared };
}
