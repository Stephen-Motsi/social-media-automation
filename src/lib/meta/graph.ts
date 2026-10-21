import { createHmac } from "node:crypto";

// Thin wrapper around the Meta Graph API, shared by Facebook, Instagram and WhatsApp clients.

export class GraphApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const graphVersion = () => process.env.META_GRAPH_API_VERSION ?? "v23.0";
// Overridable for local testing against a mock server.
const graphBase = () => (process.env.META_GRAPH_BASE_URL ?? "https://graph.facebook.com").replace(/\/$/, "");

// Proves server-side calls come from our app; required if "Require App Secret" is on in the Meta app.
function appSecretProof(accessToken: string) {
  const secret = process.env.META_APP_SECRET;
  return secret ? createHmac("sha256", secret).update(accessToken).digest("hex") : undefined;
}

export async function graphRequest<T>(
  path: string,
  accessToken: string | null,
  init: {
    method?: "GET" | "POST" | "DELETE";
    body?: Record<string, unknown>;
    query?: Record<string, string | undefined>;
  } = {},
): Promise<T> {
  const url = new URL(`${graphBase()}/${graphVersion()}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) url.searchParams.set(k, v);
  const proof = accessToken ? appSecretProof(accessToken) : undefined;
  if (proof) url.searchParams.set("appsecret_proof", proof);

  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.error?.message ?? `Graph API request failed (${res.status})`;
    throw new GraphApiError(message, res.status, json?.error);
  }
  return json as T;
}
