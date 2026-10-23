// TikTok Login Kit + Content Posting API (photo posts).
// Docs: https://developers.tiktok.com/doc/login-kit-web
//       https://developers.tiktok.com/doc/oauth-user-access-token-management
//       https://developers.tiktok.com/doc/content-posting-api-reference-photo-post
// Until TikTok audits the app, posts can only be private (SELF_ONLY).
// Photo URLs must be on a domain/prefix verified in the TikTok developer portal.

export class TikTokApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

const authBase = () => (process.env.TIKTOK_AUTH_BASE_URL ?? "https://www.tiktok.com").replace(/\/$/, "");
const apiBase = () => (process.env.TIKTOK_API_BASE_URL ?? "https://open.tiktokapis.com").replace(/\/$/, "");

export const TIKTOK_STATE_COOKIE = "tiktok_oauth_state";

// user.info.profile returns the @username, used to confirm the right account was linked
export const TIKTOK_SCOPES = ["user.info.basic", "user.info.profile", "video.publish"];

export const tiktokConfigured = () => Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);

export function tiktokRedirectUri() {
  return `${(process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/tiktok/callback`;
}

export function tiktokAuthorizeUrl(state: string) {
  const url = new URL(`${authBase()}/v2/auth/authorize/`);
  url.searchParams.set("client_key", process.env.TIKTOK_CLIENT_KEY!);
  url.searchParams.set("scope", TIKTOK_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", tiktokRedirectUri());
  url.searchParams.set("state", state);
  return url.toString();
}

export type TikTokTokens = {
  access_token: string;
  expires_in: number;
  open_id: string;
  refresh_token: string;
  refresh_expires_in: number;
  scope: string;
};

async function tokenRequest(params: Record<string, string>): Promise<TikTokTokens> {
  const res = await fetch(`${apiBase()}/v2/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      ...params,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new TikTokApiError(json.error_description ?? json.error ?? `TikTok token request failed (${res.status})`, res.status, json);
  }
  return json as TikTokTokens;
}

export const tiktokExchangeCode = (code: string) =>
  tokenRequest({ code, grant_type: "authorization_code", redirect_uri: tiktokRedirectUri() });

export const tiktokRefresh = (refreshToken: string) =>
  tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });

// TikTok API responses carry { data, error: { code: "ok" | ..., message } }
async function api<T>(path: string, token: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json; charset=UTF-8" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json.error && json.error.code !== "ok")) {
    throw new TikTokApiError(json.error?.message || `TikTok request failed (${res.status})`, res.status, json.error);
  }
  return json.data as T;
}

export async function tiktokGetUser(token: string) {
  const data = await api<{ user: { open_id: string; display_name: string; username?: string; avatar_url?: string } }>(
    "/v2/user/info/?fields=open_id,display_name,username,avatar_url",
    token,
  );
  return data.user;
}

export async function tiktokPublishPhoto(
  token: string,
  opts: { imageUrls: string[]; caption: string },
): Promise<{ publish_id: string }> {
  // The creator's allowed privacy levels decide what we can use.
  const creator = await api<{ privacy_level_options: string[] }>("/v2/post/publish/creator_info/query/", token, {
    method: "POST",
    body: {},
  });
  const wanted = process.env.TIKTOK_PRIVACY_LEVEL ?? "SELF_ONLY";
  const privacy = creator.privacy_level_options.includes(wanted)
    ? wanted
    : creator.privacy_level_options.includes("SELF_ONLY")
      ? "SELF_ONLY"
      : creator.privacy_level_options[0];

  const firstLine = opts.caption.split("\n")[0] ?? "";
  return api<{ publish_id: string }>("/v2/post/publish/content/init/", token, {
    method: "POST",
    body: {
      post_info: {
        title: firstLine.slice(0, 90),
        description: opts.caption.slice(0, 4000),
        privacy_level: privacy,
        disable_comment: false,
        auto_add_music: true,
      },
      source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: opts.imageUrls },
      post_mode: "DIRECT_POST",
      media_type: "PHOTO",
    },
  });
}
