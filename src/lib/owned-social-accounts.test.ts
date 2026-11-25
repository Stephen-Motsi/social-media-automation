import assert from "node:assert/strict";
import { prisma } from "./db";
import { decrypt, encrypt } from "./crypto";
import { disconnectOwnedSocialAccount, disconnectSocialAccounts, listOwnedSocialAccounts, saveAuthorizedSocialAccount, verifyOwnedSocialAccount } from "./owned-social-accounts";
import { accessTokenFor } from "./tokens";
import { connectByHandle } from "./connect-by-handle";

process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
type RecordType = {
  id: string; ownerId: string | null; platform: "X"; externalId: string; displayName: string;
  handle: string; profileUrl: string; accessTokenEncrypted: string; refreshTokenEncrypted: string | null;
  tokenExpiresAt: Date | null; disconnectedAt: Date | null;
};
const records: RecordType[] = [
  { id: "a", ownerId: "alice", platform: "X", externalId: "ext-a", displayName: "Alice", handle: "alice", profileUrl: "https://x.com/alice", accessTokenEncrypted: encrypt("token-a"), refreshTokenEncrypted: encrypt("refresh-a"), tokenExpiresAt: null, disconnectedAt: null },
  { id: "b", ownerId: "bob", platform: "X", externalId: "ext-b", displayName: "Bob", handle: "bob", profileUrl: "https://x.com/bob", accessTokenEncrypted: encrypt("token-b"), refreshTokenEncrypted: null, tokenExpiresAt: null, disconnectedAt: null },
  { id: "staff", ownerId: null, platform: "X", externalId: "ext-staff", displayName: "Staff", handle: "staff", profileUrl: "https://x.com/staff", accessTokenEncrypted: encrypt("token-staff"), refreshTokenEncrypted: null, tokenExpiresAt: null, disconnectedAt: null },
];
const history = { post: { id: "post" }, target: { accountId: "staff", postId: "post" }, log: { accountId: "staff" } };
const personalHistory = { post: { id: "personal-post" }, target: { accountId: "a", postId: "personal-post" }, log: { accountId: "a" } };
const attempts = new Map<string, Record<string, unknown>>();
const journal = {
  findUnique: async ({ where }: { where: { key: string } }) => attempts.get(where.key) ?? null,
  create: async ({ data }: { data: { key: string } }) => { attempts.set(data.key, { ...data }); return data; },
  updateMany: async ({ where, data }: { where: { key: string; generation: string }; data: Record<string, unknown> }) => {
    const attempt = attempts.get(where.key);
    assert.ok(attempt);
    if (attempt.generation !== where.generation) return { count: 0 };
    Object.assign(attempt, data);
    return { count: 1 };
  },
  delete: async ({ where }: { where: { key: string } }) => { attempts.delete(where.key); },
  deleteMany: async ({ where }: { where: { key: string | { in: string[] }; generation?: string } }) => {
    const keys = typeof where.key === "string" ? [where.key] : where.key.in;
    return { count: keys.filter((key) => {
      const attempt = attempts.get(key);
      if (!attempt || (where.generation !== undefined && attempt.generation !== where.generation)) return false;
      return attempts.delete(key);
    }).length };
  },
};
Object.defineProperty(prisma, "tokenRefreshAttempt", { value: journal });
Object.defineProperty(prisma, "socialAccount", {
  value: {
    findMany: async ({ where }: { where: { ownerId: string | null; id?: { in: string[] }; platform?: string; disconnectedAt?: null } }) =>
      records.filter((r) => r.ownerId === where.ownerId
        && (!where.id || where.id.in.includes(r.id))
        && (!where.platform || where.platform === r.platform)
        && (where.disconnectedAt === undefined || r.disconnectedAt === where.disconnectedAt)),
    findFirst: async ({ where }: { where: { id: string; ownerId: string; disconnectedAt: null } }) =>
      records.find((r) => r.id === where.id && r.ownerId === where.ownerId && r.disconnectedAt === where.disconnectedAt) ?? null,
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
      const record = records.find((r) => r.id === where.id);
      if (!record) throw new Error("Not found");
      return { ...record };
    },
    findFirstOrThrow: async ({ where }: { where: { platform: string; externalId: string; ownerId: string | null } }) => {
      const record = records.find((r) => r.platform === where.platform && r.externalId === where.externalId && r.ownerId === where.ownerId);
      assert.ok(record);
      return { id: record.id };
    },
    updateMany: async ({ where, data }: { where: { id?: string | { in: string[] }; platform?: string; externalId?: string; ownerId?: string | null; disconnectedAt?: null; accessTokenEncrypted?: string; refreshTokenEncrypted?: string | null; tokenExpiresAt?: Date | null }; data: Partial<RecordType> }) => {
      const matched = records.filter((r) => (where.ownerId === undefined || r.ownerId === where.ownerId)
        && (where.id === undefined || (typeof where.id === "string" ? r.id === where.id : where.id.in.includes(r.id)))
        && (where.platform === undefined || r.platform === where.platform)
        && (where.externalId === undefined || r.externalId === where.externalId)
        && (where.disconnectedAt === undefined || r.disconnectedAt === where.disconnectedAt)
        && (where.accessTokenEncrypted === undefined || r.accessTokenEncrypted === where.accessTokenEncrypted)
        && (where.refreshTokenEncrypted === undefined || r.refreshTokenEncrypted === where.refreshTokenEncrypted)
        && (where.tokenExpiresAt === undefined || r.tokenExpiresAt?.getTime() === where.tokenExpiresAt?.getTime()));
      for (const record of matched) Object.assign(record, data);
      return { count: matched.length };
    },
    create: async ({ data }: { data: RecordType }) => {
      if (records.some((r) => r.platform === data.platform && r.externalId === data.externalId)) throw new Error("Unique account belongs to another owner");
      records.push(data);
      return data;
    },
    upsert: async ({ where, update }: { where: { ownerId: string | null; platform_externalId: { platform: string; externalId: string } }; update: Partial<RecordType> }) => {
      const record = records.find((r) => r.ownerId === where.ownerId && r.platform === where.platform_externalId.platform && r.externalId === where.platform_externalId.externalId);
      assert.ok(record);
      Object.assign(record, update);
      return record;
    },
    update: async ({ where, data }: { where: { id: string; disconnectedAt: null }; data: Partial<RecordType> }) => {
      const record = records.find((r) => r.id === where.id && r.disconnectedAt === where.disconnectedAt);
      if (!record) throw new Error("Disconnected");
      Object.assign(record, data);
      return record;
    },
  },
});
Object.defineProperty(prisma, "$transaction", { value: async (operation: (tx: unknown) => Promise<unknown>) => operation({ socialAccount: prisma.socialAccount, tokenRefreshAttempt: journal, $queryRaw: async () => [{ acquired: true }] }) });
Object.defineProperty(prisma, "channel", { value: { findFirst: async () => ({ handle: "staff" }) } });

async function main() {
  assert.deepEqual((await listOwnedSocialAccounts("alice")).map((a) => a.id), ["a"]);
  assert.equal(await disconnectOwnedSocialAccount("alice", "b"), false);
  assert.equal(decrypt(records[1].accessTokenEncrypted), "token-b");
  const stale = { ...records[0], createdAt: new Date(), updatedAt: new Date() };
  attempts.set("account:a", { key: "account:a", accessTokenEncrypted: encrypt("rotated") });
  assert.equal(await disconnectOwnedSocialAccount("alice", "a"), true);
  assert.equal(attempts.has("account:a"), false);
  assert.equal(records[0].id, personalHistory.target.accountId);
  assert.equal(personalHistory.target.postId, personalHistory.post.id);
  assert.equal(personalHistory.log.accountId, records[0].id);
  assert.equal(decrypt(records[0].accessTokenEncrypted), "");
  assert.equal(records[0].refreshTokenEncrypted, null);
  await assert.rejects(() => accessTokenFor(stale), /disconnected/);
  const data = { displayName: "new", handle: "new", profileUrl: "https://x.com/new", accessTokenEncrypted: encrypt("new"), tokenExpiresAt: null, disconnectedAt: null };
  await assert.rejects(() => saveAuthorizedSocialAccount("X", "ext-b", "alice", data), /another owner/);
  await assert.rejects(() => saveAuthorizedSocialAccount("X", "ext-staff", "alice", data), /another owner/);
  assert.equal(decrypt(records[1].accessTokenEncrypted), "token-b");
  await saveAuthorizedSocialAccount("X", "ext-a", "alice", data);
  assert.equal(records[0].disconnectedAt, null);
  assert.equal(decrypt(records[0].accessTokenEncrypted), "new");
  assert.equal(await disconnectSocialAccounts(null, ["staff", "b"]), 1);
  assert.equal(records[2].id, history.target.accountId);
  assert.equal(history.target.postId, history.post.id);
  assert.equal(history.log.accountId, records[2].id);
  assert.equal(decrypt(records[2].accessTokenEncrypted), "");
  assert.equal(records[2].refreshTokenEncrypted, null);
  assert.ok(records[2].disconnectedAt);
  assert.equal(decrypt(records[1].accessTokenEncrypted), "token-b");
  await assert.rejects(() => accessTokenFor({ ...records[2], createdAt: new Date(), updatedAt: new Date() }), /disconnected/);
  await saveAuthorizedSocialAccount("X", "ext-staff", null, data);
  assert.equal(records[2].disconnectedAt, null);
  assert.equal(decrypt(records[2].accessTokenEncrypted), "new");
  assert.equal(await disconnectSocialAccounts(null, ["staff"]), 1);
  process.env.X_API_KEY = "test-key";
  process.env.X_API_SECRET = "test-secret";
  process.env.X_ACCESS_TOKEN = "test-token";
  process.env.X_ACCESS_TOKEN_SECRET = "test-token-secret";
  globalThis.fetch = async () => Response.json({ data: { id: "ext-staff", name: "Staff", username: "staff" } });
  assert.equal((await connectByHandle("X")).ok, true);
  assert.equal(records[2].disconnectedAt, null);
  assert.equal(history.target.accountId, records[2].id);
  await assert.rejects(() => verifyOwnedSocialAccount("alice", "b"), /not found/);
  let revoked = true;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth2/token")) return Response.json({ access_token: "refreshed", refresh_token: "rotated", expires_in: 3600 });
    if (revoked) return Response.json({ detail: "Revoked" }, { status: 401 });
    return Response.json({ data: { id: "ext-a", name: "Alice", username: "alice" } });
  };
  await assert.rejects(() => verifyOwnedSocialAccount("alice", "a"), /Revoked/);
  revoked = false;
  records[0].tokenExpiresAt = new Date(Date.now() - 1000);
  records[0].refreshTokenEncrypted = encrypt("refresh-a");
  await verifyOwnedSocialAccount("alice", "a");
  assert.equal(decrypt(records[0].accessTokenEncrypted), "refreshed");
  assert.equal(decrypt(records[0].refreshTokenEncrypted!), "rotated");
  console.log("PASS owned reads, disconnect, cross-owner claims, revoked/expired credentials and staff reconnection");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
