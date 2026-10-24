import { createHmac, randomBytes } from "node:crypto";
// Give up on a platform call that hangs, so the admin gets a reason instead of a frozen button.
const API_TIMEOUT_MS = 20_000;

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

// ---- Auth: OAuth 2.0 bearer tokens (Connect button) or OAuth 1.0a keys (X developer portal) ----
// An OAuth 1.0a account is stored as "oauth1:<access token>:<access token secret>" and signed with
// the app's API key and secret (X_API_KEY / X_API_SECRET). That's what lets an admin connect X by
// handle alone: the keys generated once in the developer portal for that account.
const OAUTH1_PREFIX = "oauth1:";
export const xOAuth1Token = (token: string, secret: string) => `${OAUTH1_PREFIX}${token}:${secret}`;
export const xPortalKeysConfigured = () =>
  Boolean(process.env.X_API_KEY && process.env.X_API_SECRET && process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_TOKEN_SECRET);

const pct = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// `fixed` is for tests only (a known nonce and time).
export function xAuthHeader(method: "GET" | "POST", url: string, token: string, fixed?: { nonce: string; timestamp: string }): string {
  if (!token.startsWith(OAUTH1_PREFIX)) return `Bearer ${token}`;
  const [accessToken, tokenSecret] = token.slice(OAUTH1_PREFIX.length).split(":");
  const consumerKey = process.env.X_API_KEY ?? "";
  const consumerSecret = process.env.X_API_SECRET ?? "";
  const u = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: fixed?.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: fixed?.timestamp ?? Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };
  // JSON and multipart bodies aren't part of the signature; query parameters are.
  const params = [...Object.entries(oauth), ...u.searchParams.entries()]
    .map(([k, v]) => [pct(k), pct(v)])
    .sort(([a, b], [c, d]) => (a === c ? (b < d ? -1 : 1) : a < c ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = [method, pct(`${u.origin}${u.pathname}`), pct(params)].join("&");
  const signature = createHmac("sha1", `${pct(consumerSecret)}&${pct(tokenSecret)}`).update(base).digest("base64");
  return "OAuth " + Object.entries({ ...oauth, oauth_signature: signature }).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(", ");
}

export const X_STATE_COOKIE = "x_oauth_state";
export const X_VERIFIER_COOKIE = "x_oauth_verifier";

// dm.read + dm.write: send subscribed adverts to people as direct messages
export const X_SCOPES = ["tweet.read", "tweet.write", "users.read", "media.write", "dm.read", "dm.write", "offline.access"];

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
  const res = await fetch(`${apiBase()}/2/oauth2/token`, { signal: AbortSignal.timeout(API_TIMEOUT_MS),
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
  const res = await fetch(`${apiBase()}/2/users/me`, { signal: AbortSignal.timeout(API_TIMEOUT_MS), headers: { Authorization: xAuthHeader("GET", `${apiBase()}/2/users/me`, token) } });
  return (await parse<{ data: { id: string; name: string; username: string } }>(res)).data;
}

export async function xUploadImage(token: string, data: Uint8Array, mimeType: string) {
  const form = new FormData();
  form.set("media", new Blob([Buffer.from(data)], { type: mimeType }), "image");
  form.set("media_category", "tweet_image");
  form.set("media_type", mimeType);
  const res = await fetch(`${apiBase()}/2/media/upload`, { signal: AbortSignal.timeout(API_TIMEOUT_MS),
    method: "POST",
    headers: { Authorization: xAuthHeader("POST", `${apiBase()}/2/media/upload`, token) },
    body: form,
  });
  return (await parse<{ data: { id: string } }>(res)).data.id;
}

export async function xCreatePost(token: string, text: string, mediaIds: string[] = []) {
  const res = await fetch(`${apiBase()}/2/tweets`, { signal: AbortSignal.timeout(API_TIMEOUT_MS),
    method: "POST",
    headers: { Authorization: xAuthHeader("POST", `${apiBase()}/2/tweets`, token), "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }),
  });
  return (await parse<{ data: { id: string } }>(res)).data;
}

export async function xUserByUsername(token: string, username: string) {
  const res = await fetch(`${apiBase()}/2/users/by/username/${encodeURIComponent(username)}`, { signal: AbortSignal.timeout(API_TIMEOUT_MS), headers: { Authorization: xAuthHeader("GET", `${apiBase()}/2/users/by/username/${encodeURIComponent(username)}`, token) } });
  return (await parse<{ data?: { id: string; username: string } }>(res)).data ?? null;
}

// Direct message to one person. X only delivers it if they accept messages from this account.
export async function xSendDm(token: string, participantId: string, text: string) {
  const res = await fetch(`${apiBase()}/2/dm_conversations/with/${participantId}/messages`, { signal: AbortSignal.timeout(API_TIMEOUT_MS),
    method: "POST",
    headers: { Authorization: xAuthHeader("POST", `${apiBase()}/2/dm_conversations/with/${participantId}/messages`, token), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return (await parse<{ data: { dm_event_id: string } }>(res)).data;
}
