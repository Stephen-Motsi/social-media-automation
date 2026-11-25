import assert from "node:assert/strict";
import IORedis from "ioredis";
import { prisma } from "./db";
import { encrypt } from "./crypto";
import { assistedWhatsappStatus } from "./whatsapp-requests";

process.env.WAHA_BASE_URL = "http://waha.test";
process.env.WAHA_API_KEY = "test-key";
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
Object.defineProperties(IORedis.prototype, {
  connect: { value: async () => undefined },
  set: { value: async () => "OK" },
  eval: { value: async () => 1 },
  quit: { value: async () => "OK" },
});

type RequestRecord = { id: string; userId: string; status: string; qrExpiresAt: Date | null; error: string | null };
const requests: RequestRecord[] = [
  { id: "alice-request", userId: "alice", status: "PENDING", qrExpiresAt: null, error: null },
  { id: "bob-request", userId: "bob", status: "IN_PROGRESS", qrExpiresAt: new Date(Date.now() + 60_000), error: null },
];
const session: Record<string, unknown> = {
  id: "bob-session", userId: "bob", sessionName: "bob-session", status: "SCAN_QR_CODE",
  webhookSecretEncrypted: encrypt("secret"), qrData: "data:image/png;base64,Ym9i",
  qrGeneratedAt: new Date(), qrExpiresAt: new Date(Date.now() + 60_000), qrGenerationCount: 1,
  authMethod: "QR", phoneNumber: null, recoveryEnabled: true,
};
Object.defineProperty(prisma, "wahaConfiguration", { value: { findUnique: async () => null } });
Object.defineProperty(prisma, "whatsappConnectionRequest", {
  value: {
    findUnique: async ({ where }: { where: { userId?: string; id?: string } }) =>
      requests.find((r) => where.userId ? r.userId === where.userId : r.id === where.id) ?? null,
    findUniqueOrThrow: async ({ where }: { where: { userId?: string; id?: string } }) => {
      const request = requests.find((r) => where.userId ? r.userId === where.userId : r.id === where.id);
      if (!request) throw new Error("Not found");
      return { ...request };
    },
    updateMany: async ({ where, data }: { where: { id: string; status: string; qrExpiresAt: Date | null }; data: Partial<RequestRecord> }) => {
      const request = requests.find((r) => r.id === where.id && r.status === where.status && r.qrExpiresAt?.getTime() === where.qrExpiresAt?.getTime());
      if (!request) return { count: 0 };
      Object.assign(request, data);
      return { count: 1 };
    },
  },
});
Object.defineProperty(prisma, "whatsappSession", {
  value: {
    findUnique: async ({ where }: { where: { userId?: string } }) => where.userId === "bob" ? { ...session } : null,
    update: async ({ data }: { data: Record<string, unknown> }) => {
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === "object" && value !== null && "increment" in value) session[key] = Number(session[key] ?? 0) + Number(value.increment);
        else session[key] = value;
      }
      return { ...session };
    },
  },
});
let remoteStatus = "SCAN_QR_CODE";
let logoutCalls = 0;
let identityAvailable = false;
globalThis.fetch = async (input) => {
  const path = new URL(String(input)).pathname;
  if (path.endsWith("/logout") || path.endsWith("/stop")) { logoutCalls++; remoteStatus = "STOPPED"; }
  if (path.endsWith("/me")) {
    return identityAvailable ? Response.json({ id: "123456789@c.us", pushName: "Bob" }) : new Response("Unavailable", { status: 503 });
  }
  return Response.json({ status: remoteStatus, config: { webhooks: [{ url: "http://host.docker.internal:3000/api/webhooks/waha" }] } });
};

async function main() {
  const alice = await assistedWhatsappStatus("alice");
  assert.equal(alice.status, "PENDING");
  assert.equal(alice.qr, null);
  assert.equal((await assistedWhatsappStatus("unknown")).qr, null);
  const bob = await assistedWhatsappStatus("bob");
  assert.equal(bob.qr, "data:image/png;base64,Ym9i");
  assert.equal(alice.account, null);
  remoteStatus = "WORKING";
  assert.equal((await assistedWhatsappStatus("bob")).status, "CONNECTION_ERROR");
  assert.equal(requests[1].status, "IN_PROGRESS");
  identityAvailable = true;
  assert.equal((await assistedWhatsappStatus("bob")).status, "CONNECTED");
  assert.equal(requests[1].status, "CONNECTED");
  requests[1].status = "IN_PROGRESS";
  remoteStatus = "SCAN_QR_CODE";
  requests[1].qrExpiresAt = new Date(Date.now() - 1000);
  const expired = await assistedWhatsappStatus("bob");
  assert.equal(expired.status, "EXPIRED");
  assert.equal(expired.qr, null);
  assert.equal(requests[1].status, "EXPIRED");
  assert.equal(logoutCalls, 1);
  assert.equal(session.recoveryEnabled, false);
  requests[1].status = "PREPARING";
  assert.equal((await assistedWhatsappStatus("bob")).qr, null);
  console.log("PASS WhatsApp request isolation, QR expiry, session stop and regeneration gate");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
