import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { confirmWahaOperationStopped, withWahaSessionLock as withSessionLock } from "@/lib/waha-session-lock";
import { claimWahaIdentity, WAHA_IDENTITY_CONFLICT, WAHA_IDENTITY_UNKNOWN, WAHA_SESSION_CHANGED } from "@/lib/waha-identity";
import {
  createWahaSession,
  deleteWahaSession as deleteRemoteWahaSession,
  getWahaMe,
  getWahaQr,
  getWahaSession,
  logoutWahaSession,
  normalizeWahaPhoneNumber,
  restartWahaSession,
  requestWahaPairingCode as requestWahaPairingCodeFromClient,
  startWahaSession,
  stopWahaSession,
  updateWahaSession,
  wahaWebhookUrl,
  WahaApiError,
  canRequestWahaPairingCode,
  wahaPairingCodeExpiry,
  shouldFetchWahaQr,
  wahaQrExpiryMs,
  WAHA_QR_REFETCH_MS,
} from "@/lib/waha";

export type WahaLifecycleView = {
  status: string;
  sessionName: string | null;
  account: string | null;
  phone: string | null;
  qr: string | null;
  qrExpiresAt?: string | null;
  pairingMismatch?: boolean;
  authMethod?: "QR" | "PHONE";
  pairingCode?: string | null;
  pairingCodeExpiresAt?: string | null;
  error?: string;
};

function normalizeStatus(value: unknown) {
  if (typeof value !== "string") return "CONNECTION_ERROR";
  const status = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return ["STOPPED", "STARTING", "SCAN_QR_CODE", "WORKING", "FAILED", "DISCONNECTED", "LOGGED_OUT"].includes(status)
    ? status
    : "CONNECTION_ERROR";
}

async function confirmWahaStopped(sessionName: string) {
  let session: unknown;
  try {
    session = await getWahaSession(sessionName);
  } catch (error) {
    if (error instanceof WahaApiError && error.status === 404) { confirmWahaOperationStopped(); return; }
    throw error;
  }
  if (!session || typeof session !== "object" || !("status" in session)
    || !["STOPPED", "LOGGED_OUT"].includes(normalizeStatus(session.status))) {
    throw new Error("WAHA has not confirmed that the WhatsApp session stopped.");
  }
  confirmWahaOperationStopped();
}

async function updateLifecycleStatus(userId: string, status: string, error?: string) {
  const existing = await prisma.whatsappSession.findUnique({ where: { userId } });
  if (!existing) return;
  const changed = existing.status !== status;
  await prisma.whatsappSession.updateMany({
    where: {
      userId, stateVersion: existing.stateVersion, status: { not: "STOPPING" },
      NOT: [
        { status: "FAILED", recoveryEnabled: false, lastError: { startsWith: WAHA_IDENTITY_CONFLICT } },
        { status: "FAILED", recoveryEnabled: false, lastError: { startsWith: WAHA_IDENTITY_UNKNOWN } },
      ],
    },
    data: {
      previousStatus: changed ? existing.status : existing.previousStatus,
      status,
      lastStatusAt: new Date(),
      lastError: error ?? (["WORKING", "SCAN_QR_CODE", "STARTING"].includes(status) ? null : existing.lastError),
      stateVersion: { increment: 1 },
      ...(status !== "SCAN_QR_CODE" ? { qrGeneratedAt: null, qrExpiresAt: null } : {}),
      ...(status !== "SCAN_QR_CODE" ? { qrData: null } : {}),
      ...(status === "WORKING" ? { recoveryAttemptCount: 0, lastRecoveryAt: null, pairingCode: null, pairingCodeExpiresAt: null } : {}),
    },
  });
}

async function finishPendingStop(userId: string, sessionName: string) {
  return withSessionLock(sessionName, async () => {
    const session = await prisma.whatsappSession.findUnique({ where: { userId } });
    if (!session || session.sessionName !== sessionName || session.status !== "STOPPING") return;
    const blocked = session.lastError?.startsWith(WAHA_IDENTITY_CONFLICT) || session.lastError?.startsWith(WAHA_IDENTITY_UNKNOWN);
    try {
      let stopError: unknown;
      try {
        if (blocked) {
          await stopWahaSession(sessionName);
        } else {
          await logoutWahaSession(sessionName).catch(async (error: unknown) => {
            if (error instanceof WahaApiError && error.status === 404) return;
            await stopWahaSession(sessionName);
          });
        }
      } catch (error) {
        stopError = error;
      }
      try {
        await confirmWahaStopped(sessionName);
      } catch (error) {
        if (stopError) console.error("[WAHA] Shutdown request failed:", stopError);
        throw error;
      }
      const completed = await prisma.whatsappSession.updateMany({
        where: { userId, sessionName, status: "STOPPING", stateVersion: session.stateVersion },
        data: {
          status: blocked ? "FAILED" : "STOPPED",
          accountId: null,
          accountPhone: null,
          activeIdentity: null,
          accountName: null,
          accountPushName: null,
          accountInfo: {},
          qrGeneratedAt: null,
          qrExpiresAt: null,
          qrData: null,
          recoveryEnabled: false,
          recoveryAttemptCount: 0,
          lastRecoveryAt: null,
          lastError: blocked ? session.lastError : null,
          lastStatusAt: new Date(),
          stateVersion: { increment: 1 },
        },
      });
      if (!completed.count) throw new Error("WhatsApp session changed while confirming shutdown. Check its status again.");
    } catch (error) {
      console.error("[WAHA] Could not confirm session shutdown:", error);
      throw error;
    }
  });
}

export async function syncWahaSession(userId: string, sessionName: string, retry = 0): Promise<{ status: string; account: Record<string, unknown> | null }> {
  return withSessionLock(sessionName, () => syncWahaSessionLocked(userId, sessionName, retry));
}

async function syncWahaSessionLocked(userId: string, sessionName: string, retry: number): Promise<{ status: string; account: Record<string, unknown> | null }> {
  const initial = await prisma.whatsappSession.findUnique({ where: { userId } });
  if (!initial) return { status: "NOT_CREATED", account: null };
  if (initial.sessionName !== sessionName) throw new Error("WhatsApp session changed. Check its status again.");
  if (initial.status === "STOPPING") return { status: "CONNECTION_ERROR", account: null };
  if (initial.status === "FAILED" && !initial.recoveryEnabled
    && (initial.lastError?.startsWith(WAHA_IDENTITY_CONFLICT) || initial.lastError?.startsWith(WAHA_IDENTITY_UNKNOWN))) {
    return { status: "FAILED", account: null };
  }
  let status = "CONNECTION_ERROR";
  let account: Record<string, unknown> | null = null;
  try {
    const response = await getWahaSession(sessionName) as { status?: string; config?: { webhooks?: Array<{ url?: string }> } } | null;
    status = normalizeStatus(response?.status);
    const desiredWebhookUrl = wahaWebhookUrl();
    const webhooks = response?.config?.webhooks ?? [];
    if (!webhooks.some((webhook) => webhook.url === desiredWebhookUrl)) {
      const existing = await prisma.whatsappSession.findUnique({ where: { userId } });
      if (existing?.webhookSecretEncrypted) {
        await updateWahaSession(sessionName, decrypt(existing.webhookSecretEncrypted)).catch((error: unknown) => {
          console.error("[WAHA] webhook configuration update failed:", error instanceof Error ? error.message : error);
        });
      }
    }
    if (status === "WORKING") account = await getWahaMe(sessionName).catch(() => null) as Record<string, unknown> | null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach WAHA.";
    await updateLifecycleStatus(userId, "CONNECTION_ERROR", message);
    return { status: "CONNECTION_ERROR", account: null };
  }

  if (status === "WORKING") {
    const result = account ? await claimWahaIdentity(userId, initial.stateVersion, account) : { ok: false as const, error: WAHA_IDENTITY_UNKNOWN };
    if (!result.ok) {
      if (result.error === WAHA_SESSION_CHANGED && retry < 2) return syncWahaSession(userId, sessionName, retry + 1);
      const error = result.error === WAHA_SESSION_CHANGED ? WAHA_IDENTITY_UNKNOWN : result.error;
      if (error === WAHA_IDENTITY_CONFLICT || (error === WAHA_IDENTITY_UNKNOWN && (account || !initial.activeIdentity))) {
        const blocked = await prisma.whatsappSession.updateMany({
          where: {
            userId, sessionName,
            status: { not: "STOPPING" },
          },
          data: { status: "STOPPING", recoveryEnabled: false, lastError: error, stateVersion: { increment: 1 } },
        });
        if (blocked.count) {
          try {
            await finishPendingStop(userId, sessionName);
          } catch (error) {
            console.error("[WAHA] Unverified session shutdown requires recovery or reconciliation:", error);
          }
        }
        return { status: blocked.count ? "FAILED" : "CONNECTION_ERROR", account: null };
      }
      if (error === WAHA_IDENTITY_UNKNOWN) {
        await prisma.whatsappSession.updateMany({
          where: { userId, stateVersion: initial.stateVersion },
          data: { status: "CONNECTION_ERROR", lastError: error, stateVersion: { increment: 1 } },
        });
      }
      return { status: "CONNECTION_ERROR", account: null };
    }
    return { status, account };
  }
  if (status === "CONNECTION_ERROR") {
    await updateLifecycleStatus(userId, status, "WAHA did not report a valid session status.");
  } else {
    await updateLifecycleStatus(userId, status);
  }
  return { status, account };
}

export async function getWahaView(userId: string): Promise<WahaLifecycleView> {
  const existing = await prisma.whatsappSession.findUnique({ where: { userId } });
  if (!existing) return { status: "NOT_CREATED", sessionName: null, account: null, phone: null, qr: null };
  return withSessionLock(existing.sessionName, () => getWahaViewLocked(userId, existing.sessionName));
}

async function getWahaViewLocked(userId: string, sessionName: string): Promise<WahaLifecycleView> {
  const existing = await prisma.whatsappSession.findUnique({ where: { userId } });
  if (!existing) return { status: "NOT_CREATED", sessionName: null, account: null, phone: null, qr: null };
  if (existing.sessionName !== sessionName) throw new Error("WhatsApp session changed. Check its status again.");
  const synced = await syncWahaSession(userId, existing.sessionName);
  let qr: string | null = null;
  let qrError: string | undefined;
  const expired = existing.qrExpiresAt && existing.qrExpiresAt.getTime() <= Date.now();
  if (synced.status === "SCAN_QR_CODE" && existing.authMethod !== "PHONE" && existing.qrGenerationCount >= 6) {
    try {
      await withSessionLock(existing.sessionName, async () => {
        const latest = await prisma.whatsappSession.findUnique({ where: { userId } });
        if (!latest || latest.status === "STOPPING") throw new Error("WhatsApp shutdown is pending confirmation.");
        await restartWahaSession(existing.sessionName);
        const restarted = await prisma.whatsappSession.updateMany({
          where: { userId, status: { not: "STOPPING" } },
          data: {
            status: "STARTING",
            qrGeneratedAt: null,
            qrExpiresAt: null,
            qrData: null,
            qrGenerationCount: 0,
            authMethod: null,
            pairingCode: null,
            pairingCodeRequestedAt: null,
            pairingCodeExpiresAt: null,
            recoveryAttemptCount: { increment: 1 },
            lastStatusAt: new Date(),
            lastError: null,
            stateVersion: { increment: 1 },
          },
        });
        if (!restarted.count) throw new Error("WhatsApp shutdown is pending confirmation.");
      });
      return { status: "STARTING", sessionName: existing.sessionName, account: null, phone: existing.phoneNumber, qr: null, qrExpiresAt: null };
    } catch (error) {
      qrError = error instanceof Error ? error.message : "Could not restart the WhatsApp session.";
      await updateLifecycleStatus(userId, "FAILED", qrError);
      return { status: "FAILED", sessionName: existing.sessionName, account: null, phone: existing.phoneNumber, qr: null, qrExpiresAt: null, error: qrError };
    }
  }
  const qrNeedsRefresh = !expired && existing.qrExpiresAt && existing.qrGeneratedAt
    && existing.qrGeneratedAt.getTime() > Date.now() - WAHA_QR_REFETCH_MS;
  if (synced.status === "SCAN_QR_CODE" && existing.qrData && existing.qrExpiresAt && !expired && existing.authMethod !== "PHONE") {
    qr = existing.qrData;
  }
  if (
    existing.authMethod !== "PHONE"
    && shouldFetchWahaQr(synced.status, existing.qrGenerationCount)
    && (!qrNeedsRefresh || expired)
  ) {
    try {
      const fresh = await getWahaQr(existing.sessionName);
      qr = fresh.qr;
      if (qr) {
        const imageExpired = !existing.qrExpiresAt || existing.qrExpiresAt.getTime() <= Date.now();
        const nextGeneration = imageExpired ? existing.qrGenerationCount + 1 : existing.qrGenerationCount;
        const generation = nextGeneration > 0 ? nextGeneration : 1;
        const qrExpiresAt = imageExpired
          ? new Date(Date.now() + wahaQrExpiryMs(generation))
          : existing.qrExpiresAt;
        await prisma.whatsappSession.update({
          where: { userId },
          data: {
            qrGeneratedAt: new Date(),
            qrExpiresAt,
            qrGenerationCount: generation,
            qrData: qr,
            lastError: null,
          },
        });
      } else {
        qrError = "WAHA has not produced a QR code yet. Retrying automatically.";
      }
    } catch (error) {
      qrError = error instanceof Error ? error.message : "Could not retrieve the WAHA QR code.";
      await updateLifecycleStatus(userId, synced.status, qrError);
    }
  }

  // Phone pairing is challenge generation, not an authentication timeout. Generate once,
  // cache the code, and leave status polling responsible only for detecting WORKING.
  if (
    synced.status === "SCAN_QR_CODE"
    && existing.authMethod === "PHONE"
    && existing.phoneNumber
    && (!existing.pairingCode || canRequestWahaPairingCode(synced.status, false, wahaPairingCodeExpiry(existing.pairingCodeRequestedAt, existing.pairingCodeExpiresAt)))
  ) {
    const requestedRecently = existing.pairingCodeRequestedAt
      && existing.pairingCodeRequestedAt.getTime() > Date.now() - 3_000;
    if (!requestedRecently) {
      try {
        await withSessionLock(existing.sessionName, async () => {
          const latest = await prisma.whatsappSession.findUnique({ where: { userId } });
          if (latest?.authMethod === "PHONE" && latest.phoneNumber && canRequestWahaPairingCode(latest.status, false, latest.pairingCode ? wahaPairingCodeExpiry(latest.pairingCodeRequestedAt, latest.pairingCodeExpiresAt) : null)) {
            await prisma.whatsappSession.update({
              where: { userId },
              data: { pairingCodeRequestedAt: new Date(), lastError: null },
            });
            const result = await requestWahaPairingCodeFromClient(existing.sessionName, latest.phoneNumber);
            await prisma.whatsappSession.update({
              where: { userId },
              data: {
                pairingCode: result.code,
                pairingCodeRequestedAt: new Date(),
                pairingCodeExpiresAt: new Date(Date.now() + 60_000),
                lastError: null,
              },
            });
          }
        });
      } catch (error) {
        qrError = error instanceof Error ? error.message : "Pairing-code generation failed.";
        await updateLifecycleStatus(userId, synced.status, qrError);
      }
    }
  }

  const refreshed = await prisma.whatsappSession.findUnique({ where: { userId } });
  const pairingCodeExpiresAt = wahaPairingCodeExpiry(refreshed?.pairingCodeRequestedAt, refreshed?.pairingCodeExpiresAt);
  const actualPhone = typeof synced.account?.phone === "string"
    ? String(synced.account.phone)
    : typeof synced.account?.id === "string"
      ? synced.account.id.split("@")[0]
      : typeof synced.account?.jid === "string"
        ? synced.account.jid.split("@")[0]
        : refreshed?.accountPhone ?? refreshed?.phoneNumber;
  const normalizedActual = typeof actualPhone === "string" ? actualPhone.replace(/\D/g, "") : "";
  const mismatch = synced.status === "WORKING" && !!refreshed?.phoneNumber && (!normalizedActual || normalizedActual !== refreshed.phoneNumber.replace(/\D/g, ""));
  return {
    status: synced.status,
    sessionName: existing.sessionName,
    account: synced.account?.pushName
      ? String(synced.account.pushName)
      : synced.account?.pushname
        ? String(synced.account.pushname)
        : refreshed?.accountName ?? null,
    phone: normalizedActual || refreshed?.phoneNumber || null,
    qr,
    qrExpiresAt: qr && refreshed?.qrExpiresAt ? refreshed.qrExpiresAt.toISOString() : null,
    pairingMismatch: mismatch,
    authMethod: refreshed?.authMethod === "PHONE" ? "PHONE" : "QR",
    pairingCode: refreshed?.pairingCode && !canRequestWahaPairingCode("SCAN_QR_CODE", false, pairingCodeExpiresAt)
      ? refreshed.pairingCode
      : null,
    pairingCodeExpiresAt: refreshed?.pairingCode && pairingCodeExpiresAt && pairingCodeExpiresAt.getTime() > Date.now()
      ? pairingCodeExpiresAt.toISOString()
      : null,
    error: qrError ?? (mismatch ? "The paired WhatsApp account does not match the entered phone number. Disconnect and pair the correct account." : refreshed?.lastError ?? undefined),
  };
}

export async function requestWahaPairingCode(userId: string, phoneNumber: string): Promise<WahaLifecycleView> {
  const normalizedPhone = normalizeWahaPhoneNumber(phoneNumber);
  let existing = await prisma.whatsappSession.findUnique({ where: { userId } });
  if (!existing) {
    await connectWahaSession(userId, normalizedPhone);
    existing = await prisma.whatsappSession.findUnique({ where: { userId } });
  }
  if (!existing) {
    return { status: "CONNECTION_ERROR", sessionName: null, account: null, phone: normalizedPhone, qr: null, authMethod: "PHONE", error: "Could not create the WhatsApp session." };
  }
  return withSessionLock(existing.sessionName, async () => {
    existing = await prisma.whatsappSession.findUniqueOrThrow({ where: { userId } });
    if (existing.status === "STOPPING") throw new Error("WhatsApp shutdown is pending confirmation. Try again after it completes.");
    await prisma.whatsappSession.update({
      where: { userId },
      data: {
        phoneNumber: normalizedPhone,
        authMethod: "PHONE",
        qrGeneratedAt: null,
        qrExpiresAt: null,
        qrData: null,
        ...(existing.phoneNumber !== normalizedPhone ? {
          pairingCode: null,
          pairingCodeRequestedAt: null,
          pairingCodeExpiresAt: null,
        } : {}),
      },
    });
    let absent = false;
    const current = await getWahaSession(existing.sessionName).catch((error: unknown) => {
      if (error instanceof WahaApiError && error.status === 404) { absent = true; return null; }
      throw error;
    }) as { status?: string } | null;
    const status = absent ? "STOPPED" : normalizeStatus(current?.status);

    if (status === "WORKING") {
      return getWahaView(userId);
    }
    if (status === "STARTING" || status === "STOPPED") {
      if (status === "STOPPED") {
        try {
          await startWahaSession(existing.sessionName);
          await updateLifecycleStatus(userId, "STARTING");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not start the WAHA session.";
          if (error instanceof WahaApiError && error.status === 504) {
            await updateLifecycleStatus(userId, "STARTING", "WAHA browser startup is still in progress. Checking pairing readiness automatically.");
          } else {
            await updateLifecycleStatus(userId, "CONNECTION_ERROR", message);
          }
        }
      }
      return {
        status: "STARTING",
        sessionName: existing.sessionName,
        account: existing.accountName,
        phone: normalizedPhone,
        qr: null,
        authMethod: "PHONE",
        pairingCode: null,
        error: "Session is starting. Request the pairing code again when WAHA reports SCAN_QR_CODE.",
      };
    }
    if (status === "FAILED") {
      try {
        await restartWahaSession(existing.sessionName);
        await updateLifecycleStatus(userId, "STARTING");
        return {
          status: "STARTING",
          sessionName: existing.sessionName,
          account: existing.accountName,
          phone: normalizedPhone,
          qr: null,
          authMethod: "PHONE",
          pairingCode: null,
          error: "WAHA is restarting. Request the pairing code again when pairing is ready.",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "WAHA restart failed.";
        if (error instanceof WahaApiError && error.status === 504) {
          await updateLifecycleStatus(userId, "STARTING", "WAHA restart is in progress. Checking pairing readiness automatically.");
        } else {
          await updateLifecycleStatus(userId, "FAILED", message);
        }
        if (error instanceof WahaApiError && error.status === 504) {
          return {
            status: "STARTING",
            sessionName: existing.sessionName,
            account: existing.accountName,
            phone: normalizedPhone,
            qr: null,
            authMethod: "PHONE",
            pairingCode: null,
            error: "Restart is still starting. The next status check will request the code when WAHA is ready.",
          };
        }
        return { status: "FAILED", sessionName: existing.sessionName, account: existing.accountName, phone: normalizedPhone, qr: null, authMethod: "PHONE", pairingCode: null, error: message };
      }
    }
    if (status !== "SCAN_QR_CODE") {
      return { status, sessionName: existing.sessionName, account: existing.accountName, phone: normalizedPhone, qr: null, authMethod: "PHONE", pairingCode: null, error: "Phone-number pairing is not available in the current session state. QR authentication remains available." };
    }

    if (
      existing.phoneNumber === normalizedPhone
      && existing.pairingCode
      && !canRequestWahaPairingCode("SCAN_QR_CODE", false, wahaPairingCodeExpiry(existing.pairingCodeRequestedAt, existing.pairingCodeExpiresAt))
    ) {
      return {
        status,
        sessionName: existing.sessionName,
        account: existing.accountName,
        phone: normalizedPhone,
        qr: null,
        authMethod: "PHONE",
        pairingCode: existing.pairingCode,
        pairingCodeExpiresAt: wahaPairingCodeExpiry(existing.pairingCodeRequestedAt, existing.pairingCodeExpiresAt)?.toISOString() ?? null,
        error: "The current pairing code is still active.",
      };
    }

    try {
      const result = await requestWahaPairingCodeFromClient(existing.sessionName, normalizedPhone);
      const expiresAt = new Date(Date.now() + 60_000);
      await prisma.whatsappSession.update({
        where: { userId },
        data: {
          pairingCode: result.code,
          pairingCodeRequestedAt: new Date(),
          pairingCodeExpiresAt: expiresAt,
          authMethod: "PHONE",
          lastError: null,
        },
      });
      return {
        status,
        sessionName: existing.sessionName,
        account: existing.accountName,
        phone: normalizedPhone,
        qr: null,
        authMethod: "PHONE",
        pairingCode: result.code,
        pairingCodeExpiresAt: expiresAt.toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Phone-number pairing is unavailable.";
      await updateLifecycleStatus(userId, status, message);
      if (error instanceof WahaApiError && error.status === 422) {
        return { status, sessionName: existing.sessionName, account: existing.accountName, phone: normalizedPhone, qr: null, authMethod: "PHONE", pairingCode: null, error: "WAHA is not ready to issue a pairing code yet. It will retry when the session is ready." };
      }
      return { status, sessionName: existing.sessionName, account: existing.accountName, phone: normalizedPhone, qr: null, authMethod: "PHONE", pairingCode: null, error: message };
    }
  });
}

export async function connectWahaSession(userId: string, phoneNumber?: string): Promise<WahaLifecycleView> {
  const existing = await prisma.whatsappSession.findUnique({ where: { userId } });
  const sessionName = existing?.sessionName ?? `whatsapp-user-${userId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return withSessionLock(sessionName, async () => {
    const current = await prisma.whatsappSession.findUnique({ where: { userId } });
    if (current && current.sessionName !== sessionName) throw new Error("WhatsApp session changed. Try again.");
    return connectWahaSessionLocked(userId, phoneNumber);
  });
}

async function connectWahaSessionLocked(userId: string, phoneNumber?: string): Promise<WahaLifecycleView> {
  let normalizedPhone = "";
  if (phoneNumber !== undefined) {
    normalizedPhone = normalizeWahaPhoneNumber(phoneNumber);
  }
  let existing = await prisma.whatsappSession.findUnique({ where: { userId } });
  if (!existing) {
    const sessionName = `whatsapp-user-${userId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const result = await withSessionLock(sessionName, async () => {
      let record = await prisma.whatsappSession.findUnique({ where: { userId } });
      if (record) return { record, created: false };
      const webhookSecret = randomBytes(32).toString("hex");
      const created = await createWahaSession(sessionName, webhookSecret);
      record = await prisma.whatsappSession.create({
        data: {
          userId,
          sessionName,
          phoneNumber: normalizedPhone || null,
          status: "STOPPED",
          webhookSecretEncrypted: created.secretEncrypted,
          recoveryEnabled: true,
        },
      });
      return { record, created: true };
    });
    if (result.created) return startWahaSessionRecord(userId, result.record.sessionName, true);
    existing = result.record;
  }

  if (normalizedPhone && existing.phoneNumber !== normalizedPhone) {
    existing = await prisma.whatsappSession.update({
      where: { userId },
      data: {
        phoneNumber: normalizedPhone,
        authMethod: "QR",
        pairingCode: null,
        pairingCodeExpiresAt: null,
        qrGenerationCount: 0,
      },
    });
  }
  if (!normalizedPhone || existing.phoneNumber === normalizedPhone) {
    existing = await prisma.whatsappSession.update({
      where: { userId },
      data: { authMethod: "QR", pairingCode: null, pairingCodeExpiresAt: null, ...(normalizedPhone ? { phoneNumber: normalizedPhone } : {}) },
    });
  }
  return startWahaSessionRecord(userId, existing.sessionName, false);
}

async function startWahaSessionRecord(userId: string, sessionName: string, newSession: boolean): Promise<WahaLifecycleView> {
  return withSessionLock(sessionName, async () => {
    const lifecycleRecord = await prisma.whatsappSession.findUnique({ where: { userId } });
    if (lifecycleRecord?.status === "STOPPING") throw new Error("WhatsApp shutdown is pending confirmation. Try again after it completes.");
    if (lifecycleRecord?.webhookSecretEncrypted) {
      try {
        await updateWahaSession(sessionName, decrypt(lifecycleRecord.webhookSecretEncrypted));
      } catch (error) {
        console.error("[WAHA] Could not update session webhook configuration:", error instanceof Error ? error.message : error);
      }
    }
    let absent = false;
    const current = await getWahaSession(sessionName).catch((error: unknown) => {
      if (error instanceof WahaApiError && error.status === 404) { absent = true; return null; }
      throw error;
    }) as { status?: string } | null;
    const status = absent ? "STOPPED" : normalizeStatus(current?.status);
    if (status === "CONNECTION_ERROR") throw new Error("WAHA did not report a valid session status.");

    if (status === "WORKING") return getWahaView(userId);
    if (absent && !newSession) {
      const existing = await prisma.whatsappSession.findUnique({ where: { userId } });
      if (!existing) return getWahaView(userId);
      const secret = decrypt(existing.webhookSecretEncrypted);
      const webhookSecret = secret || randomBytes(32).toString("hex");
      const recreated = await createWahaSession(sessionName, webhookSecret);
      await prisma.whatsappSession.update({
        where: { userId },
        data: { webhookSecretEncrypted: recreated.secretEncrypted, recoveryEnabled: true },
      });
    }
    if (["STARTING", "SCAN_QR_CODE"].includes(status)) {
      const existing = await prisma.whatsappSession.findUnique({ where: { userId } });
      return {
        status,
        sessionName,
        account: existing?.accountName ?? null,
        phone: existing?.phoneNumber ?? null,
        qr: null,
        qrExpiresAt: null,
      };
    }

    if (status === "FAILED") {
      const existing = await prisma.whatsappSession.findUnique({ where: { userId } });
      if (existing && existing.recoveryAttemptCount >= 1) {
        await updateLifecycleStatus(userId, "FAILED", existing.lastError ?? "WAHA session restart has already been attempted.");
        return { status: "FAILED", sessionName, account: existing.accountName, phone: existing.phoneNumber, qr: null, error: existing.lastError ?? "WAHA session restart has already been attempted." };
      }
      const starting = await prisma.whatsappSession.updateMany({
        where: { userId, status: { not: "STOPPING" } },
        data: { status: "STARTING", recoveryAttemptCount: 1, lastRecoveryAt: new Date(), lastStatusAt: new Date(), stateVersion: { increment: 1 }, lastError: null },
      });
      if (!starting.count) throw new Error("WhatsApp shutdown is pending confirmation.");
      try {
        await restartWahaSession(sessionName);
      } catch (error) {
        const message = error instanceof Error ? error.message : "WAHA restart failed.";
        await prisma.whatsappSession.updateMany({
          where: { userId, status: { not: "STOPPING" } },
          data: { status: "STARTING", lastError: `Restart request pending verification: ${message}`, stateVersion: { increment: 1 } },
        });
        return { status: "STARTING", sessionName, account: existing?.accountName ?? null, phone: existing?.phoneNumber ?? null, qr: null, qrExpiresAt: null, error: `Restart request did not confirm immediately: ${message}` };
      }
      return { status: "STARTING", sessionName, account: null, phone: existing?.phoneNumber ?? null, qr: null, qrExpiresAt: null };
    }

    const starting = await prisma.whatsappSession.updateMany({
      where: { userId, status: { not: "STOPPING" } },
      data: { status: "STARTING", previousStatus: current ? status : "STOPPED", recoveryEnabled: true, lastStatusAt: new Date(), stateVersion: { increment: 1 }, lastError: null },
    });
    if (!starting.count) throw new Error("WhatsApp shutdown is pending confirmation.");
    const existing = await prisma.whatsappSession.findUnique({ where: { userId } });
    try {
      await startWahaSession(sessionName);
      return { status: "STARTING", sessionName, account: existing?.accountName ?? null, phone: existing?.phoneNumber ?? null, qr: null, qrExpiresAt: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "WAHA start request failed.";
      await prisma.whatsappSession.updateMany({
        where: { userId, status: { not: "STOPPING" } },
        data: { lastError: `Start request pending verification: ${message}`, stateVersion: { increment: 1 } },
      });
      return { status: "STARTING", sessionName, account: existing?.accountName ?? null, phone: existing?.phoneNumber ?? null, qr: null, qrExpiresAt: null, error: `Start request did not confirm immediately: ${message}` };
    }
  });
}

export async function reconnectWahaSession(userId: string, phoneNumber?: string) {
  return connectWahaSession(userId, phoneNumber);
}

export async function disconnectWahaSession(userId: string) {
  const existing = await prisma.whatsappSession.findUnique({ where: { userId } });
  if (!existing) return { status: "NOT_CREATED", sessionName: null, account: null, phone: null, qr: null } satisfies WahaLifecycleView;
  await withSessionLock(existing.sessionName, async () => {
    await prisma.whatsappSession.update({
      where: { userId },
      data: { status: "STOPPING", previousStatus: existing.status, recoveryEnabled: false, lastError: null, stateVersion: { increment: 1 } },
    });
  });
  await finishPendingStop(userId, existing.sessionName);
  return getWahaView(userId);
}

export async function deleteWahaSession(userId: string) {
  const existing = await prisma.whatsappSession.findUnique({ where: { userId } });
  if (!existing) return { status: "NOT_CREATED", sessionName: null, account: null, phone: null, qr: null } satisfies WahaLifecycleView;
  await withSessionLock(existing.sessionName, async () => {
    await prisma.whatsappSession.update({
      where: { userId },
      data: { status: "STOPPING", recoveryEnabled: false, stateVersion: { increment: 1 } },
    });
    await logoutWahaSession(existing.sessionName).catch(async (error: unknown) => {
      if (error instanceof WahaApiError && error.status === 404) return;
      await stopWahaSession(existing.sessionName);
    });
    await confirmWahaStopped(existing.sessionName);
    await deleteRemoteWahaSession(existing.sessionName).catch((error: unknown) => {
      if (!(error instanceof WahaApiError) || error.status !== 404) throw error;
    });
    await prisma.whatsappSession.delete({ where: { userId } });
  });
  return { status: "NOT_CREATED", sessionName: null, account: null, phone: null, qr: null } satisfies WahaLifecycleView;
}

export async function recoverWahaSessions() {
  const pendingStops = await prisma.whatsappSession.findMany({
    where: { status: "STOPPING" },
    select: { userId: true, sessionName: true },
    orderBy: { lastRecoveryAt: { sort: "asc", nulls: "first" } },
    take: 20,
  });
  for (const session of pendingStops) {
    try {
      await prisma.whatsappSession.updateMany({
        where: { userId: session.userId, status: "STOPPING" },
        data: { lastRecoveryAt: new Date() },
      });
      await finishPendingStop(session.userId, session.sessionName);
    } catch (error) {
      console.error("[WAHA] Pending shutdown retry failed:", error);
    }
  }
  const cutoff = new Date(Date.now() - 10 * 60_000);
  const sessions = await prisma.whatsappSession.findMany({
    where: {
      recoveryEnabled: true,
      status: { in: ["STARTING", "SCAN_QR_CODE", "FAILED", "DISCONNECTED", "CONNECTION_ERROR"] },
      OR: [{ lastRecoveryAt: null }, { lastRecoveryAt: { lt: cutoff } }, { recoveryAttemptCount: { lt: 5 } }],
      user: {
        OR: [
          { whatsappRequest: { is: null } },
          { whatsappRequest: { is: { status: "CONNECTED" } } },
          { whatsappRequest: { is: { status: "IN_PROGRESS", qrExpiresAt: { gt: new Date() } } } },
        ],
      },
    },
    take: 20,
  });
  let recovered = 0;
  for (const session of sessions) {
    if (session.status === "LOGGED_OUT") continue;
    await getWahaView(session.userId).catch((error) => {
      void error;
    });
    const current = await prisma.whatsappSession.findUnique({ where: { id: session.id } });
    if (!current || ["WORKING", "STOPPED", "LOGGED_OUT"].includes(current.status)) continue;
    const request = await prisma.whatsappConnectionRequest.findUnique({ where: { userId: session.userId } });
    if (request && request.status !== "CONNECTED"
      && !(request.status === "IN_PROGRESS" && request.qrExpiresAt && request.qrExpiresAt.getTime() > Date.now())) continue;
    if (["STARTING", "SCAN_QR_CODE"].includes(current.status)) continue;
    const windowCount = session.lastRecoveryAt && session.lastRecoveryAt >= cutoff ? session.recoveryAttemptCount : 0;
    if (windowCount >= 5) continue;
    const delayMs = Math.min(40_000, 2_000 * (2 ** windowCount)) + Math.floor(Math.random() * 1_000);
    if (session.lastRecoveryAt && Date.now() - session.lastRecoveryAt.getTime() < delayMs) continue;
    await prisma.whatsappSession.update({
      where: { id: session.id },
      data: { recoveryAttemptCount: windowCount + 1, lastRecoveryAt: new Date() },
    });
    try {
      await startWahaSessionRecord(session.userId, session.sessionName, false);
      recovered++;
    } catch (error) {
      await prisma.whatsappSession.updateMany({
        where: { id: session.id, status: { not: "STOPPING" } },
        data: { lastError: error instanceof Error ? error.message : "WAHA recovery failed." },
      });
    }
  }
  return recovered;
}
