import { randomUUID, randomBytes } from "node:crypto";
import IORedis from "ioredis";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import {
  createWahaSession,
  deleteWahaSession as deleteRemoteWahaSession,
  getWahaMe,
  getWahaQr,
  getWahaSession,
  logoutWahaSession,
  normalizeWahaPhoneNumber,
  restartWahaSession,
  startWahaSession,
  stopWahaSession,
  WahaApiError,
  shouldFetchWahaQr,
  wahaQrExpiryMs,
} from "@/lib/waha";

export type WahaLifecycleView = {
  status: string;
  sessionName: string | null;
  account: string | null;
  phone: string | null;
  qr: string | null;
  qrExpiresAt?: string | null;
  pairingMismatch?: boolean;
  error?: string;
};

function normalizeStatus(value: unknown) {
  if (typeof value !== "string") return "STOPPED";
  const status = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return ["STOPPED", "STARTING", "SCAN_QR_CODE", "WORKING", "FAILED", "DISCONNECTED", "LOGGED_OUT"].includes(status)
    ? status
    : "CONNECTION_ERROR";
}

async function withSessionLock<T>(sessionName: string, operation: () => Promise<T>): Promise<T> {
  const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: 1 });
  const token = randomUUID();
  const key = `waha:session:${sessionName}:lock`;
  try {
    const acquired = await redis.set(key, token, "PX", 30_000, "NX");
    if (acquired !== "OK") throw new Error("Another WhatsApp connection operation is already in progress. Please try again.");
    return await operation();
  } finally {
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, token).catch(() => 0);
    await redis.quit().catch(() => redis.disconnect());
  }
}

async function updateLifecycleStatus(userId: string, status: string, error?: string) {
  const existing = await prisma.whatsappSession.findUnique({ where: { userId } });
  if (!existing) return;
  const changed = existing.status !== status;
  await prisma.whatsappSession.update({
    where: { userId },
    data: {
      previousStatus: changed ? existing.status : existing.previousStatus,
      status,
      lastStatusAt: new Date(),
      lastError: error ?? (["WORKING", "SCAN_QR_CODE", "STARTING"].includes(status) ? null : existing.lastError),
      stateVersion: { increment: 1 },
      ...(status !== "SCAN_QR_CODE" ? { qrGeneratedAt: null, qrExpiresAt: null } : {}),
      ...(status === "WORKING" ? { recoveryAttemptCount: 0, lastRecoveryAt: null } : {}),
    },
  });
}

export async function syncWahaSession(userId: string, sessionName: string): Promise<{ status: string; account: Record<string, unknown> | null }> {
  let status = "CONNECTION_ERROR";
  let account: Record<string, unknown> | null = null;
  try {
    const response = await getWahaSession(sessionName) as { status?: string } | null;
    status = normalizeStatus(response?.status);
    if (status === "WORKING") account = await getWahaMe(sessionName).catch(() => null) as Record<string, unknown> | null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach WAHA.";
    await updateLifecycleStatus(userId, "CONNECTION_ERROR", message);
    return { status: "CONNECTION_ERROR", account: null };
  }

  if (status !== "CONNECTION_ERROR") await updateLifecycleStatus(userId, status);
  if (account) {
    const id = account.id ?? account.jid ?? account.phone;
    const accountPhoneCandidate = account.phone
      ?? (typeof account.id === "string" ? account.id.split("@")[0] : null)
      ?? (typeof account.jid === "string" ? account.jid.split("@")[0] : null);
    await prisma.whatsappSession.update({
      where: { userId },
      data: {
        accountInfo: account as object,
        accountId: typeof id === "string" ? id : null,
        accountPhone: typeof accountPhoneCandidate === "string" ? String(accountPhoneCandidate).replace(/\D/g, "") || null : null,
        accountPushName: typeof account.pushName === "string" ? account.pushName : (typeof account.pushname === "string" ? String(account.pushname) : null),
        accountName: typeof account.pushName === "string" ? account.pushName : (typeof account.pushname === "string" ? String(account.pushname) : null),
      },
    });
  }
  return { status, account };
}

export async function getWahaView(userId: string): Promise<WahaLifecycleView> {
  const existing = await prisma.whatsappSession.findUnique({ where: { userId } });
  if (!existing) return { status: "NOT_CREATED", sessionName: null, account: null, phone: null, qr: null };
  const synced = await syncWahaSession(userId, existing.sessionName);
  let qr: string | null = null;
  let qrError: string | undefined;
  const expired = existing.qrExpiresAt && existing.qrExpiresAt.getTime() <= Date.now();
  if (synced.status === "SCAN_QR_CODE" && existing.qrGenerationCount >= 6) {
    try {
      await withSessionLock(existing.sessionName, async () => {
        await restartWahaSession(existing.sessionName);
        await prisma.whatsappSession.update({
          where: { userId },
          data: {
            status: "STARTING",
            qrGeneratedAt: null,
            qrExpiresAt: null,
            qrGenerationCount: 0,
            recoveryAttemptCount: { increment: 1 },
            lastStatusAt: new Date(),
            lastError: null,
          },
        });
      });
      return { status: "STARTING", sessionName: existing.sessionName, account: null, phone: existing.phoneNumber, qr: null, qrExpiresAt: null };
    } catch (error) {
      qrError = error instanceof Error ? error.message : "Could not restart the WhatsApp session.";
      await updateLifecycleStatus(userId, "FAILED", qrError);
      return { status: "FAILED", sessionName: existing.sessionName, account: null, phone: existing.phoneNumber, qr: null, qrExpiresAt: null, error: qrError };
    }
  }
  if (shouldFetchWahaQr(synced.status, existing.qrGenerationCount)) {
    try {
      const fresh = await getWahaQr(existing.sessionName);
      qr = fresh.qr;
      if (qr) {
        const nextGeneration = existing.qrGenerationCount || 1;
        const alreadyTracked = existing.qrGeneratedAt && existing.qrExpiresAt && existing.qrExpiresAt.getTime() > Date.now();
        await prisma.whatsappSession.update({
          where: { userId },
          data: {
            qrGeneratedAt: new Date(),
            qrExpiresAt: alreadyTracked ? existing.qrExpiresAt : new Date(Date.now() + wahaQrExpiryMs(nextGeneration)),
            qrGenerationCount: nextGeneration,
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
  const refreshed = await prisma.whatsappSession.findUnique({ where: { userId } });
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
    error: qrError ?? (mismatch ? "The paired WhatsApp account does not match the entered phone number. Disconnect and pair the correct account." : refreshed?.lastError ?? undefined),
  };
}

export async function connectWahaSession(userId: string, phoneNumber?: string): Promise<WahaLifecycleView> {
  let normalizedPhone = "";
  if (phoneNumber !== undefined) {
    normalizedPhone = normalizeWahaPhoneNumber(phoneNumber);
  }
  let existing = await prisma.whatsappSession.findUnique({ where: { userId } });
  if (!existing) {
    const sessionName = `whatsapp-user-${userId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    return withSessionLock(sessionName, async () => {
      let record = await prisma.whatsappSession.findUnique({ where: { userId } });
      if (record) return connectWahaSession(userId, phoneNumber);
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
      return startWahaSessionRecord(userId, record.sessionName, true);
    });
  }

  if (normalizedPhone && existing.phoneNumber !== normalizedPhone) {
    existing = await prisma.whatsappSession.update({
      where: { userId },
      data: { phoneNumber: normalizedPhone },
    });
  }
  return startWahaSessionRecord(userId, existing.sessionName, false);
}

async function startWahaSessionRecord(userId: string, sessionName: string, newSession: boolean): Promise<WahaLifecycleView> {
  return withSessionLock(sessionName, async () => {
    const current = await getWahaSession(sessionName).catch((error: unknown) => {
      if (error instanceof WahaApiError && error.status === 404) return null;
      throw error;
    }) as { status?: string } | null;
    const status = normalizeStatus(current?.status);

    if (status === "WORKING") return getWahaView(userId);
    if (!current && !newSession) {
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
      await prisma.whatsappSession.update({
        where: { userId },
        data: { status: "STARTING", recoveryAttemptCount: 1, lastRecoveryAt: new Date(), lastStatusAt: new Date(), stateVersion: { increment: 1 }, lastError: null },
      });
      try {
        await restartWahaSession(sessionName);
      } catch (error) {
        const message = error instanceof Error ? error.message : "WAHA restart failed.";
        await prisma.whatsappSession.update({
          where: { userId },
          data: { status: "STARTING", lastError: `Restart request pending verification: ${message}`, stateVersion: { increment: 1 } },
        });
        return { status: "STARTING", sessionName, account: existing?.accountName ?? null, phone: existing?.phoneNumber ?? null, qr: null, qrExpiresAt: null, error: `Restart request did not confirm immediately: ${message}` };
      }
      return { status: "STARTING", sessionName, account: null, phone: existing?.phoneNumber ?? null, qr: null, qrExpiresAt: null };
    }

    await prisma.whatsappSession.update({
      where: { userId },
      data: { status: "STARTING", previousStatus: current ? status : "STOPPED", recoveryEnabled: true, lastStatusAt: new Date(), stateVersion: { increment: 1 }, lastError: null },
    });
    const existing = await prisma.whatsappSession.findUnique({ where: { userId } });
    try {
      await startWahaSession(sessionName);
      return { status: "STARTING", sessionName, account: existing?.accountName ?? null, phone: existing?.phoneNumber ?? null, qr: null, qrExpiresAt: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "WAHA start request failed.";
      await prisma.whatsappSession.update({
        where: { userId },
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
    await logoutWahaSession(existing.sessionName).catch(async () => stopWahaSession(existing.sessionName));
    await prisma.whatsappSession.update({
      where: { userId },
      data: {
        status: "STOPPED",
        previousStatus: existing.status,
        accountId: null,
        accountPhone: null,
        accountName: null,
        accountPushName: null,
        accountInfo: {},
        qrGeneratedAt: null,
        qrExpiresAt: null,
        recoveryEnabled: false,
        recoveryAttemptCount: 0,
        lastRecoveryAt: null,
        lastError: null,
        lastStatusAt: new Date(),
        stateVersion: { increment: 1 },
      },
    });
  });
  return getWahaView(userId);
}

export async function deleteWahaSession(userId: string) {
  const existing = await prisma.whatsappSession.findUnique({ where: { userId } });
  if (!existing) return { status: "NOT_CREATED", sessionName: null, account: null, phone: null, qr: null } satisfies WahaLifecycleView;
  await withSessionLock(existing.sessionName, async () => {
    await logoutWahaSession(existing.sessionName).catch(async () => stopWahaSession(existing.sessionName)).catch(() => null);
    await deleteRemoteWahaSession(existing.sessionName).catch(() => null);
    await prisma.whatsappSession.delete({ where: { userId } });
  });
  return { status: "NOT_CREATED", sessionName: null, account: null, phone: null, qr: null } satisfies WahaLifecycleView;
}

export async function recoverWahaSessions() {
  const cutoff = new Date(Date.now() - 10 * 60_000);
  const sessions = await prisma.whatsappSession.findMany({
    where: {
      recoveryEnabled: true,
      status: { in: ["STARTING", "SCAN_QR_CODE", "FAILED", "DISCONNECTED", "CONNECTION_ERROR"] },
      OR: [{ lastRecoveryAt: null }, { lastRecoveryAt: { lt: cutoff } }, { recoveryAttemptCount: { lt: 5 } }],
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
      await prisma.whatsappSession.update({
        where: { id: session.id },
        data: { lastError: error instanceof Error ? error.message : "WAHA recovery failed." },
      });
    }
  }
  return recovered;
}
