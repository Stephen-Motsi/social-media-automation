import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { getWahaView, requestWahaPairingCode } from "./waha-lifecycle";

process.env.WAHA_BASE_URL = "http://waha.test";
process.env.WAHA_API_KEY = "test-key";
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");

let locked = false;
Object.defineProperty(prisma, "wahaOperationLock", { value: {
  create: async () => { if (locked) throw new Prisma.PrismaClientKnownRequestError("busy", { code: "P2002", clientVersion: "test" }); locked = true; },
  deleteMany: async () => { locked = false; return { count: 1 }; },
} });

let record: Record<string, unknown> | null = null;
Object.defineProperty(prisma, "wahaConfiguration", { value: { findUnique: async () => null } });
Object.defineProperty(prisma, "whatsappSession", {
  value: {
    findUnique: async () => record ? { ...record } : null,
    findUniqueOrThrow: async () => {
      assert.ok(record);
      return { ...record };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      record = { accountName: null, accountPhone: null, authMethod: null, pairingCode: null, pairingCodeRequestedAt: null, pairingCodeExpiresAt: null, qrGenerationCount: 6, qrExpiresAt: null, qrData: null, previousStatus: null, lastError: null, stateVersion: 0, ...data };
      return { ...record };
    },
    update: async ({ data }: { data: Record<string, unknown> }) => {
      assert.ok(record);
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === "object" && value !== null && "increment" in value) {
          record[key] = Number(record[key] ?? 0) + Number(value.increment);
        } else {
          record[key] = value;
        }
      }
      return { ...record };
    },
    updateMany: async ({ where, data }: { where: { stateVersion?: number }; data: Record<string, unknown> }) => {
      if (!record || (where.stateVersion !== undefined && record.stateVersion !== where.stateVersion)) return { count: 0 };
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === "object" && value !== null && "increment" in value) record[key] = Number(record[key] ?? 0) + Number(value.increment);
        else record[key] = value;
      }
      return { count: 1 };
    },
  },
});

let remoteStatus = "STOPPED";
let requests = 0;
let requestedPhone = "";
globalThis.fetch = async (input, init) => {
  const path = new URL(String(input)).pathname;
  if (path.endsWith("/auth/request-code")) {
    requests++;
    requestedPhone = (JSON.parse(String(init?.body)) as { phoneNumber: string }).phoneNumber;
    return Response.json({ code: requests === 1 ? "ABCD1234" : "EFGH5678" });
  }
  if (path.endsWith("/start")) remoteStatus = "STARTING";
  if (path.endsWith("/me")) return Response.json({ id: "254712345679@c.us", pushName: "Test" });
  return Response.json({ status: remoteStatus, config: { webhooks: [{ url: "http://host.docker.internal:3000/api/webhooks/waha" }] } });
};

async function main() {
  const starting = await requestWahaPairingCode("test-user", "254712345678");
  assert.equal(starting.status, "STARTING");
  assert.equal(record?.authMethod, "PHONE");
  assert.equal(locked, false);

  remoteStatus = "SCAN_QR_CODE";
  const first = await getWahaView("test-user");
  assert.equal(first.pairingCode, "ABCD-1234");
  assert.equal(requests, 1);
  await getWahaView("test-user");
  assert.equal(requests, 1);
  await requestWahaPairingCode("test-user", "254712345678");
  assert.equal(requests, 1);
  const changedPhone = await requestWahaPairingCode("test-user", "254712345679");
  assert.equal(changedPhone.pairingCode, "EFGH-5678");
  assert.equal(requestedPhone, "254712345679");
  assert.equal(requests, 2);

  assert.ok(record);
  record.pairingCodeRequestedAt = new Date(Date.now() - 61_000);
  record.pairingCodeExpiresAt = new Date(Date.now() + 86_400_000);
  const refreshed = await getWahaView("test-user");
  assert.equal(refreshed.pairingCode, "EFGH-5678");
  assert.equal(requests, 3);

  remoteStatus = "WORKING";
  const connected = await getWahaView("test-user");
  assert.equal(connected.status, "WORKING");
  assert.equal(connected.pairingCode, null);
  assert.equal(connected.pairingMismatch, false);
  console.log("PASS waha pairing lifecycle");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });