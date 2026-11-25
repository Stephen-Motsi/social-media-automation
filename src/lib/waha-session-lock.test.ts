import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { confirmWahaOperationStopped, markWahaOperationUncertain, withWahaSessionLock } from "./waha-session-lock";
import { startWahaSession } from "./waha";

const locks = new Map<string, string>();
process.env.WAHA_BASE_URL = "http://waha.test";
process.env.WAHA_API_KEY = "test-key";
Object.defineProperty(prisma, "wahaConfiguration", { value: { findUnique: async () => null } });
Object.defineProperty(prisma, "wahaOperationLock", { value: {
  create: async ({ data }: { data: { sessionName: string; token: string } }) => {
    if (locks.has(data.sessionName)) throw new Prisma.PrismaClientKnownRequestError("busy", { code: "P2002", clientVersion: "test" });
    locks.set(data.sessionName, data.token);
  },
  deleteMany: async ({ where }: { where: { sessionName: string; token: string } }) => {
    if (locks.get(where.sessionName) !== where.token) return { count: 0 };
    locks.delete(where.sessionName);
    return { count: 1 };
  },
} });

async function main() {
  let started!: () => void;
  let finish!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const wait = new Promise<void>((resolve) => { finish = resolve; });
  const first = withWahaSessionLock("one", async () => { started(); await wait; });
  await entered;
  const originalNow = Date.now;
  Date.now = () => originalNow() + 120_000;
  try {
    await assert.rejects(() => withWahaSessionLock("one", async () => {}), /in progress or requires reconciliation/);
    await withWahaSessionLock("another", async () => {});
  } finally {
    Date.now = originalNow;
    finish();
  }
  await first;
  await withWahaSessionLock("one", async () => {
    await withWahaSessionLock("one", async () => assert.equal(locks.size, 1));
  });
  await assert.rejects(() => withWahaSessionLock("one", async () => { throw new Error("failed"); }), /failed/);
  assert.equal(locks.size, 0);
  globalThis.fetch = async () => Response.json({ error: "unavailable" }, { status: 503 });
  await assert.rejects(() => withWahaSessionLock("uncertain", async () => {
    try { await startWahaSession("uncertain"); } catch { /* caller may handle the provider error */ }
  }), /outcome is unknown/);
  assert.ok(locks.has("uncertain"));
  await assert.rejects(() => withWahaSessionLock("uncertain", async () => {}), /requires reconciliation/);
  await withWahaSessionLock("confirmed", async () => {
    markWahaOperationUncertain();
    confirmWahaOperationStopped();
  });
  assert.equal(locks.has("confirmed"), false);
  locks.set("orphaned", "old-process");
  await assert.rejects(() => withWahaSessionLock("orphaned", async () => {}), /requires reconciliation/);
  assert.equal(locks.get("orphaned"), "old-process");
  console.log("PASS durable WAHA lock contention, long operation and orphaned claim");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
