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

const version = () => process.env.META_GRAPH_API_VERSION ?? "v23.0";

export async function graphRequest<T>(
  path: string,
  accessToken: string,
  init: { method?: "GET" | "POST" | "DELETE"; body?: Record<string, unknown> } = {},
): Promise<T> {
  const url = `https://graph.facebook.com/${version()}/${path.replace(/^\//, "")}`;
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
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
