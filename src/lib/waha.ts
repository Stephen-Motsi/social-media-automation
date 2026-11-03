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

export function wahaPairingTimeoutMs(value: string | undefined, fallback = 10_000) {
  return wahaHttpTimeoutMs(value, fallback);
}

export function wahaSessionControlTimeoutMs(value: string | undefined, fallback = 5_000) {
  return wahaHttpTimeoutMs(value, fallback);
}

export function canStartReconnect(pending: boolean, status: string) {
  return !pending && !["WORKING", "STARTING", "SCAN_QR_CODE"].includes(status);
}

export function canRequestWahaPairingCode(status: string, pending = false, existingCodeExpiresAt?: Date | null) {
  if (pending || status !== "SCAN_QR_CODE") return false;
  return !existingCodeExpiresAt || existingCodeExpiresAt.getTime() <= Date.now();
}

export function formatWahaPairingCode(code: unknown) {
  if (typeof code !== "string") return null;
  const normalized = code.trim().toUpperCase();
  return /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/.test(normalized)
    ? normalized.includes("-") ? normalized : `${normalized.slice(0, 4)}-${normalized.slice(4)}`
    : null;
}

export async function wahaConfigured() {
  return Boolean(await getWahaCredentials());
}

export type WahaConnectionTest = {
  reachable: boolean;
  authenticated: boolean;
  version: string | null;
  message: string;
};

export async function testWahaConnection(baseUrl: string, apiKey: string): Promise<WahaConnectionTest> {
  const timeoutMs = wahaHttpTimeoutMs(process.env.WAHA_HTTP_TIMEOUT_MS, 15_000);
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/sessions`, {
      headers: { accept: "application/json", "x-api-key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    console.error(`[WAHA] connection test ${timedOut ? "timed out" : "failed"} after ${timeoutMs}ms`);
    return {
      reachable: !timedOut,
      authenticated: false,
      version: null,
      message: timedOut
        ? "The connection took too long. Your WAHA server may be offline or experiencing problems."
        : "We cannot reach your WAHA server. Please check the server address and make sure WAHA is running.",
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      reachable: true,
      authenticated: false,
      version: null,
      message: "The server is reachable, but the access key is incorrect. Please check your WAHA API Key.",
    };
  }
  if (!response.ok) {
    return {
      reachable: true,
      authenticated: false,
      version: null,
      message: "WAHA responded, but the connection could not be verified. Please check the server address and API key.",
    };
  }

  let version: string | null = null;
  try {
    const status = await fetch(`${baseUrl.replace(/\/$/, "")}/api/server/status`, {
      headers: { accept: "application/json", "x-api-key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    }).then((result) => result.ok ? result.json() as Promise<Record<string, unknown>> : null).catch(() => null);
    if (typeof status?.version === "string") version = status.version;
    else if (typeof status?.server === "string") version = status.server;
  } catch {
    // Version information is optional for a successful connection.
  }

  return {
    reachable: true,
    authenticated: true,
    version,
    message: version
      ? `Your WAHA server is connected successfully (WAHA ${version}). You can now connect WhatsApp.`
      : "Your WAHA server is connected successfully. You can now connect WhatsApp.",
  };
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

async function request(path: string, init: RequestInit = {}, timeoutOverrideMs?: number) {
  const config = await credentials();
  const operationTimeout = timeoutOverrideMs ?? Number(process.env.WAHA_HTTP_TIMEOUT_MS ?? 15_000);
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
      throw new WahaApiError(504, `WAHA timed out while performing ${operation}. The session state will be checked automatically.`);
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
  return request(`/api/sessions/${encodeURIComponent(sessionName)}/start`, { method: "POST" }, wahaSessionControlTimeoutMs(process.env.WAHA_SESSION_CONTROL_TIMEOUT_MS));
}

export async function restartWahaSession(sessionName: string) {
  return request(`/api/sessions/${encodeURIComponent(sessionName)}/restart`, { method: "POST" }, wahaSessionControlTimeoutMs(process.env.WAHA_SESSION_CONTROL_TIMEOUT_MS));
}

export async function updateWahaSession(sessionName: string, webhookSecret: string) {
  return request(`/api/sessions/${encodeURIComponent(sessionName)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: sessionName,
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
  const timeoutMs = (() => {
    const value = Number(process.env.WAHA_HTTP_TIMEOUT_MS ?? 15_000);
    return Number.isFinite(value) && value > 0 ? value : 15_000;
  })();
  const paths = [
    `/api/${encodeURIComponent(sessionName)}/auth/qr`,
    `/api/${encodeURIComponent(sessionName)}/auth/qr?format=image`,
  ];
  let lastError: unknown;
  for (const path of paths) {
    try {
      const response = await fetch(`${config.baseUrl}${path}`, {
        headers: { accept: "image/png, application/json", "x-api-key": config.apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 422) continue;
      if (!response.ok) {
        lastError = new Error(`WAHA QR unavailable with status ${response.status}.`);
        continue;
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const payload = await response.json() as { value?: string; data?: string; base64?: string };
        const value = payload.value ?? payload.data ?? payload.base64 ?? null;
        if (value) return { qr: value.startsWith("data:image") ? value : `data:image/png;base64,${value}`, format: "raw" };
        continue;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 0) return { qr: `data:image/png;base64,${bytes.toString("base64")}`, format: "png" };
    } catch (error) {
      lastError = error;
      console.error(`[WAHA] QR attempt timed out or failed: POST ${path}`, error instanceof Error ? error.message : error);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("WAHA QR unavailable.");
}

export async function requestWahaPairingCode(sessionName: string, phoneNumber: string): Promise<{ code: string }> {
  const normalizedPhone = normalizeWahaPhoneNumber(phoneNumber);
  const pairingTimeout = wahaPairingTimeoutMs(process.env.WAHA_PAIRING_TIMEOUT_MS);
  const response = await request(`/api/${encodeURIComponent(sessionName)}/auth/request-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: normalizedPhone }),
  }, pairingTimeout) as { code?: unknown };
  const code = formatWahaPairingCode(response.code);
  if (!code) throw new Error("WAHA did not return a valid pairing code.");
  return { code };
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
