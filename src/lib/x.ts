// X (Twitter) API v2: OAuth 2.0 with PKCE, posting and image upload.
// Docs: https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code
//       https://docs.x.com/x-api/posts/creation-of-a-post
//       https://docs.x.com/x-api/media/media-upload
// Posting needs a paid X API plan; check current limits at https://docs.x.com/x-api/getting-started/about-x-api

export class XApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

const authBase = () => (process.env.X_AUTH_BASE_URL ?? "https://x.com").replace(/\/$/, "");
const apiBase = () => (process.env.X_API_BASE_URL ?? "https://api.x.com").replace(/\/$/, "");

export const X_STATE_COOKIE = "x_oauth_state";
export const X_VERIFIER_COOKIE = "x_oauth_verifier";

export const X_SCOPES = ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"];

export const xConfigured = () => Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET);

export function xRedirectUri() {
  return `${(process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/x/callback`;
}

export function xAuthorizeUrl(state: string, codeChallenge: string) {
  const url = new URL(`${authBase()}/i/oauth2/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", process.env.X_CLIENT_ID!);
  url.searchParams.set("redirect_uri", xRedirectUri());
  url.searchParams.set("scope", X_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function parse<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.detail ?? json?.error_description ?? json?.title ?? json?.errors?.[0]?.message ?? `X request failed (${res.status})`;
    throw new XApiError(message, res.status, json);
  }
  return json as T;
}

export type XTokens = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };

async function tokenRequest(params: Record<string, string>): Promise<XTokens> {
  // Confidential client: authenticate with the client ID and secret.
  const basic = Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${apiBase()}/2/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: process.env.X_CLIENT_ID! }),
  });
  return parse<XTokens>(res);
}

export const xExchangeCode = (code: string, codeVerifier: string) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: xRedirectUri(), code_verifier: codeVerifier });

export const xRefresh = (refreshToken: string) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });

export async function xGetMe(token: string) {
  const res = await fetch(`${apiBase()}/2/users/me`, { headers: { Authorization: `Bearer ${token}` } });
  return (await parse<{ data: { id: string; name: string; username: string } }>(res)).data;
}

export async function xUploadImage(token: string, data: Uint8Array, mimeType: string) {
  const form = new FormData();
  form.set("media", new Blob([Buffer.from(data)], { type: mimeType }), "image");
  form.set("media_category", "tweet_image");
  form.set("media_type", mimeType);
  const res = await fetch(`${apiBase()}/2/media/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return (await parse<{ data: { id: string } }>(res)).data.id;
}

export async function xCreatePost(token: string, text: string, mediaIds: string[] = []) {
  const res = await fetch(`${apiBase()}/2/tweets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }),
  });
  return (await parse<{ data: { id: string } }>(res)).data;
}
