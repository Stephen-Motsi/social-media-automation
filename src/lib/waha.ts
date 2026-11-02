import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";

export type WahaCredentials = { baseUrl: string; apiKey: string };

export async function getWahaCredentials(): Promise<WahaCredentials | null> {
  const saved = await prisma.wahaConfiguration.findUnique({ where: { id: "default" } });
  if (saved) {
    try {
      return {
        baseUrl: saved.baseUrl.replace(/\/$/, ""),
        apiKey: decrypt(saved.apiKeyEncrypted),
      };
    } catch {
      return null;
    }
  }

  // Backward-compatible migration fallback only; saving in the UI replaces this configuration.
  const baseUrl = process.env.WAHA_BASE_URL?.trim().replace(/\/$/, "");
  const apiKey = process.env.WAHA_API_KEY?.trim();
  return baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

export async function wahaConfigured() {
  return Boolean(await getWahaCredentials());
}

export function wahaWebhookUrl() {
  const base = process.env.AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/webhooks/waha`;
}

async function credentials() {
  const config = await getWahaCredentials();
  if (!config) throw new Error("WAHA is not configured. Save the WAHA Base URL and API Key in Channels.");
  return config;
}

async function request(path: string, init: RequestInit = {}) {
  const config = await credentials();
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "x-api-key": config.apiKey,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`WAHA ${response.status}: ${text.slice(0, 500) || response.statusText}`);
  }
  if (!text) return null;
  return JSON.parse(text) as unknown;
}

export async function createWahaSession(sessionName: string, webhookSecret: string) {
  const secretEncrypted = encrypt(webhookSecret);
  const result = await request("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: sessionName,
      start: false,
      config: {
        metadata: { app: "social-media-automation" },
        webhooks: [{
          url: wahaWebhookUrl(),
          events: ["session.status", "message", "message.ack"],
          hmac: { key: webhookSecret },
        }],
      },
    }),
  });
  return { result, secretEncrypted };
}

export async function startWahaSession(sessionName: string) {
  return request(`/api/sessions/${encodeURIComponent(sessionName)}/start`, { method: "POST" });
}

export async function stopWahaSession(sessionName: string) {
  return request(`/api/sessions/${encodeURIComponent(sessionName)}/stop`, { method: "POST" });
}

export async function logoutWahaSession(sessionName: string) {
  return request(`/api/sessions/${encodeURIComponent(sessionName)}/logout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

export async function deleteWahaSession(sessionName: string) {
  return request(`/api/sessions/${encodeURIComponent(sessionName)}`, { method: "DELETE" });
}

export async function getWahaSession(sessionName: string) {
  return request(`/api/sessions/${encodeURIComponent(sessionName)}`);
}

export async function getWahaMe(sessionName: string) {
  return request(`/api/sessions/${encodeURIComponent(sessionName)}/me`);
}

export async function getWahaQr(sessionName: string): Promise<{ qr: string | null; format: "png" | "raw" }> {
  const config = await credentials();
  const url = `${config.baseUrl}/api/${encodeURIComponent(sessionName)}/auth/qr?format=image`;
  const response = await fetch(url, {
    headers: { accept: "image/png, application/json", "x-api-key": config.apiKey },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`WAHA QR ${response.status}: ${await response.text()}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = await response.json() as { value?: string; data?: string; base64?: string };
    const value = payload.value ?? payload.data ?? payload.base64 ?? null;
    return { qr: value ? (value.startsWith("data:image") ? value : `data:image/png;base64,${value}`) : null, format: "raw" };
  }
  return { qr: `data:image/png;base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`, format: "png" };
}

export type WahaSendResult = { id?: string; message?: unknown; [key: string]: unknown };

async function send(path: string, body: Record<string, unknown>) {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as Promise<WahaSendResult>;
}

export function sendWahaText(sessionName: string, chatId: string, text: string) {
  return send("/api/sendText", { session: sessionName, chatId, text });
}

export function sendWahaImage(sessionName: string, chatId: string, imageUrl: string, caption = "") {
  return send("/api/sendImage", { session: sessionName, chatId, file: { url: imageUrl }, caption });
}

export function sendWahaVideo(sessionName: string, chatId: string, videoUrl: string, caption = "") {
  return send("/api/sendVideo", { session: sessionName, chatId, file: { url: videoUrl }, caption, convert: true });
}

export function normalizeWahaChatId(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) throw new Error("WhatsApp recipient is missing a valid phone number.");
  return `${digits}@c.us`;
}
