import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { encrypt } from "./crypto";
import { connectWahaSession, disconnectWahaSession, recoverWahaSessions, syncWahaSession } from "./waha-lifecycle";
import { WAHA_IDENTITY_CONFLICT } from "./waha-identity";

process.env.WAHA_BASE_URL = "http://waha.test";
process.env.WAHA_API_KEY = "test-key";
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
const locks = new Map<string, string>();
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

type Session = Record<string, unknown> & { userId: string; sessionName: string; status: string; stateVersion: number; activeIdentity: string | null };
function session(userId: string): Session {
  return {
    id: userId, userId, sessionName: userId, status: "STARTING", stateVersion: 0,
    activeIdentity: null, recoveryEnabled: true, lastError: null, phoneNumber: null,
    webhookSecretEncrypted: encrypt("secret"), qrData: null, qrGenerationCount: 0,
  };
}
const sessions = [session("staff"), session("user"), session("alice"), session("bob"), session("carol"), session("dave"), session("keeper"), session("eve")];
let concurrentVersionChange = false;
let concurrentIdentityChange = false;
let staleClaimAttempts = 0;
Object.defineProperty(prisma, "wahaConfiguration", { value: { findUnique: async () => null } });
Object.defineProperty(prisma, "whatsappSession", {
  value: {
    findUnique: async ({ where }: { where: { userId?: string; id?: string } }) => {
      const current = sessions.find((item) => item.userId === (where.userId ?? where.id));
      return current ? { ...current } : null;
    },
    findMany: async ({ where }: { where: { status?: string } }) =>
      where.status === "STOPPING" ? sessions.filter((item) => item.status === "STOPPING").map((item) => ({ ...item })) : [],
    updateMany: async ({ where, data }: { where: { userId?: string; sessionName?: string; stateVersion?: number; activeIdentity?: string | null; status?: string | { not: string }; recoveryEnabled?: boolean; lastError?: string }; data: Record<string, unknown> }) => {
      const current = sessions.find((item) => item.userId === where.userId);
      if (current && typeof data.activeIdentity === "string" && staleClaimAttempts > 0) {
        current.stateVersion++;
        staleClaimAttempts--;
      }
      if (!current || (where.stateVersion !== undefined && current.stateVersion !== where.stateVersion)
        || (typeof where.status === "string" && current.status !== where.status)
        || (typeof where.status === "object" && current.status === where.status.not)
        || (where.sessionName !== undefined && current.sessionName !== where.sessionName)
        || ("activeIdentity" in where && current.activeIdentity !== where.activeIdentity)
        || (where.recoveryEnabled !== undefined && current.recoveryEnabled !== where.recoveryEnabled)
        || (typeof where.lastError === "string" && current.lastError !== where.lastError)) return { count: 0 };
      if (typeof data.activeIdentity === "string" && sessions.some((other) => other !== current && other.activeIdentity === data.activeIdentity)) {
        if (concurrentVersionChange) { current.stateVersion++; concurrentVersionChange = false; }
        if (concurrentIdentityChange) {
          current.activeIdentity = "111111111";
          current.accountId = "111111111@c.us";
          current.status = "WORKING";
          current.stateVersion++;
          concurrentIdentityChange = false;
        }
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint", { code: "P2002", clientVersion: "test" });
      }
      update(current, data);
      return { count: 1 };
    },
    update: async ({ where, data }: { where: { userId: string }; data: Record<string, unknown> }) => {
      const current = sessions.find((item) => item.userId === where.userId);
      assert.ok(current);
      update(current, data);
      return { ...current };
    },
  },
});
function update(current: Session, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "object" && value !== null && "increment" in value) current[key] = Number(current[key] ?? 0) + Number(value.increment);
    else current[key] = value;
  }
}
const remote = new Map(sessions.map((item) => [item.userId, "WORKING"]));
let failedStops = false;
let uncertainStop = false;
let rejectStoppedStop = false;
let bumpOnConfirm = false;
let statusResponse: "normal" | "empty" | "missing" | "absent" = "normal";
let stops = 0;
globalThis.fetch = async (input, init) => {
  const path = new URL(String(input)).pathname;
  const name = path.split("/")[3];
  if (path.endsWith("/me")) return Response.json({ id: "254712345678@c.us", pushName: "Account" });
  if (path.endsWith("/stop") || path.endsWith("/logout")) {
    stops++;
    if (failedStops) return Response.json({ message: "Unavailable" }, { status: 503 });
    if (rejectStoppedStop && remote.get(name) === "STOPPED") return Response.json({ message: "Already stopped" }, { status: 422 });
    if (!uncertainStop) remote.set(name, "STOPPED");
  }
  if ((!init?.method || init.method === "GET") && !path.endsWith("/me")) {
    if (statusResponse === "empty") return new Response(null, { status: 200 });
    if (statusResponse === "missing") return Response.json({ config: {} });
    if (statusResponse === "absent") return new Response(null, { status: 404 });
    if (bumpOnConfirm) {
      sessions.find((item) => item.userId === name)!.stateVersion++;
      bumpOnConfirm = false;
    }
  }
  return Response.json({ status: remote.get(name), config: { webhooks: [{ url: "http://host.docker.internal:3000/api/webhooks/waha" }] } });
};

async function main() {
  assert.equal((await syncWahaSession("staff", "staff")).status, "WORKING");
  assert.equal(sessions[0].activeIdentity, "254712345678");
  statusResponse = "missing";
  assert.equal((await syncWahaSession("staff", "staff")).status, "CONNECTION_ERROR");
  assert.equal(sessions[0].status, "CONNECTION_ERROR");
  assert.equal(sessions[0].activeIdentity, "254712345678");
  statusResponse = "normal";
  assert.equal((await syncWahaSession("staff", "staff")).status, "WORKING");
  failedStops = true;
  concurrentVersionChange = true;
  await assert.rejects(() => syncWahaSession("user", "user"), /outcome is unknown/);
  assert.equal(sessions[1].activeIdentity, null);
  assert.equal(sessions[1].status, "STOPPING");
  assert.equal(sessions[1].recoveryEnabled, false);
  assert.ok(String(sessions[1].lastError).startsWith(WAHA_IDENTITY_CONFLICT));
  assert.equal(sessions[0].activeIdentity, "254712345678");
  const calls = stops;
  await assert.rejects(() => syncWahaSession("user", "user"), /requires reconciliation/);
  assert.equal(stops, calls);
  failedStops = false;
  remote.set("user", "STOPPED");
  locks.delete("user");
  await recoverWahaSessions();
  assert.ok(stops > calls);
  assert.equal(remote.get("user"), "STOPPED");
  assert.equal(sessions[1].status, "FAILED");
  failedStops = true;
  await assert.rejects(() => disconnectWahaSession("staff"));
  assert.equal(sessions[0].activeIdentity, "254712345678");
  failedStops = false;
  await assert.rejects(() => disconnectWahaSession("staff"), /requires reconciliation/);
  remote.set("staff", "STOPPED");
  locks.delete("staff");
  remote.set("staff", "WORKING");
  uncertainStop = true;
  await assert.rejects(() => disconnectWahaSession("staff"), /not confirmed/);
  assert.equal(sessions[0].activeIdentity, "254712345678");
  uncertainStop = false;
  assert.ok(locks.has("staff"));
  remote.set("staff", "STOPPED");
  locks.delete("staff");
  for (const response of ["empty", "missing"] as const) {
    statusResponse = response;
    await assert.rejects(() => disconnectWahaSession("staff"), /not confirmed/);
    assert.equal(sessions[0].activeIdentity, "254712345678");
    assert.equal(sessions[0].status, "STOPPING");
    assert.ok(locks.has("staff"));
    locks.delete("staff");
  }
  await assert.rejects(() => connectWahaSession("staff"), /shutdown is pending/);
  statusResponse = "normal";
  bumpOnConfirm = true;
  await assert.rejects(() => disconnectWahaSession("staff"), /changed while confirming/);
  assert.equal(sessions[0].activeIdentity, "254712345678");
  rejectStoppedStop = true;
  await recoverWahaSessions();
  rejectStoppedStop = false;
  assert.equal(sessions[0].activeIdentity, null);
  assert.equal(sessions[0].status, "STOPPED");
  sessions[1].status = "STARTING";
  sessions[1].recoveryEnabled = true;
  sessions[1].stateVersion++;
  remote.set("user", "WORKING");
  assert.equal((await syncWahaSession("user", "user")).status, "WORKING");
  assert.equal(sessions[1].activeIdentity, "254712345678");
  await disconnectWahaSession("user");
  assert.equal(sessions[1].activeIdentity, null);
  const claims = await Promise.all([syncWahaSession("alice", "alice"), syncWahaSession("bob", "bob")]);
  assert.deepEqual(claims.map((claim) => claim.status).sort(), ["FAILED", "WORKING"]);
  const claimed = sessions.filter((item) => item.activeIdentity === "254712345678");
  assert.equal(claimed.length, 1);
  statusResponse = "absent";
  await disconnectWahaSession(claimed[0].userId);
  assert.equal(claimed[0].activeIdentity, null);
  statusResponse = "normal";
  staleClaimAttempts = 1;
  assert.equal((await syncWahaSession("carol", "carol")).status, "WORKING");
  await disconnectWahaSession("carol");
  staleClaimAttempts = 3;
  assert.equal((await syncWahaSession("dave", "dave")).status, "FAILED");
  assert.equal(remote.get("dave"), "STOPPED");
  assert.equal(sessions[5].status, "FAILED");
  assert.equal((await syncWahaSession("keeper", "keeper")).status, "WORKING");
  concurrentIdentityChange = true;
  failedStops = true;
  await assert.rejects(() => syncWahaSession("eve", "eve"), /outcome is unknown/);
  assert.equal(sessions[7].status, "STOPPING");
  assert.equal(sessions[7].activeIdentity, "111111111");
  failedStops = false;
  remote.set("eve", "STOPPED");
  locks.delete("eve");
  await recoverWahaSessions();
  assert.equal(sessions[7].activeIdentity, null);
  assert.equal(remote.get("eve"), "STOPPED");
  console.log("PASS duplicate races, shutdown confirmation, retry and reconnect");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
