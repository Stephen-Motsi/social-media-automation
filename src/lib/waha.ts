import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";

export class WahaApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "WahaApiError";
  }
}

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

export function wahaQrExpiryMs(generation: number) {
  return generation <= 1 ? 60_000 : 20_000;
}

export function shouldFetchWahaQr(status: string, generationCount = 0) {
  return status === "SCAN_QR_CODE" && generationCount < 6;
}

export function shouldRestartFailedSession(status: string, restartAttemptCount: number) {
  return status === "FAILED" && restartAttemptCount < 1;
}

export function wahaHttpTimeoutMs(value: string | undefined, fallback = 15_000) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function canStartReconnect(pending: boolean, status: string) {
  return !pending && !["WORKING", "STARTING", "SCAN_QR_CODE"].includes(status);
}

export async function wahaConfigured() {
  return Boolean(await getWahaCredentials());
}

export function wahaWebhookUrl() {
  const base = process.env.WAHA_WEBHOOK_URL?.trim()
    ?? (process.env.AUTH_URL ?? process.env.APP_URL ?? "http://host.docker.internal:3000").replace(/localhost:3000/, "host.docker.internal:3000");
  const normalized = base.replace(/\/$/, "");
  return normalized.endsWith("/api/webhooks/waha") ? normalized : `${normalized}/api/webhooks/waha`;
}

async function credentials() {
  const config = await getWahaCredentials();
  if (!config) throw new Error("WAHA is not configured. Save the WAHA Base URL and API Key in Channels.");
  return config;
}

async function request(path: string, init: RequestInit = {}) {
  const config = await credentials();
  const operationTimeout = Number(process.env.WAHA_HTTP_TIMEOUT_MS ?? 15_000);
  const timeoutMs = Number.isFinite(operationTimeout) && operationTimeout > 0 ? operationTimeout : 15_000;
  const operation = `${init.method ?? "GET"} ${path}`;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; }, timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      headers: {
        accept: "application/json",
        "x-api-key": config.apiKey,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch (error) {
    if (timedOut || (error instanceof Error && error.name === "TimeoutError")) {
      console.error(`[WAHA] timed out after ${timeoutMs}ms: ${operation}`);
    } else {
      console.error(`[WAHA] request failed: ${operation}`, error instanceof Error ? error.message : error);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  if (!response.ok) {
    const labels: Record<number, string> = {
      401: "WAHA authentication failed. Check the saved API key.",
      404: "WAHA session or endpoint was not found.",
      422: "WAHA cannot perform that operation in the current session state.",
      429: "WAHA rate limit reached.",
    };
    throw new WahaApiError(response.status, labels[response.status] ?? `WAHA request failed with status ${response.status}.`);
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

export async function restartWahaSession(sessionName: string) {
  return request(`/api/sessions/${encodeURIComponent(sessionName)}/restart`, { method: "POST" });
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
  const path = `/api/${encodeURIComponent(sessionName)}/auth/qr?format=image`;
  const timeoutMs = (() => {
    const value = Number(process.env.WAHA_HTTP_TIMEOUT_MS ?? 15_000);
    return Number.isFinite(value) && value > 0 ? value : 15_000;
  })();
  const response = await fetch(`${config.baseUrl}${path}`, {
    headers: { accept: "image/png, application/json", "x-api-key": config.apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((error: unknown) => {
    console.error(`[WAHA] timed out or failed: GET ${path}`, error instanceof Error ? error.message : error);
    throw error;
  });
  if (response.status === 422) {
    return { qr: null, format: "png" };
  }
  if (!response.ok) {
    throw new Error(`WAHA QR unavailable with status ${response.status}.`);
  }
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

export function normalizeWahaPhoneNumber(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!/^\d{8,15}$/.test(digits)) {
    throw new Error("Enter a WhatsApp phone number with international country code, 8-15 digits.");
  }
  return digits;
}

export function wahaPhonePairMatches(enteredPhone: string | null | undefined, accountPhone: string | null | undefined) {
  if (!enteredPhone) return true;
  if (!accountPhone) return false;
  return normalizeWahaPhoneNumber(enteredPhone) === normalizeWahaPhoneNumber(accountPhone);
}
