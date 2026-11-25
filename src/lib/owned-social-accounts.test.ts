import assert from "node:assert/strict";
import { prisma } from "./db";
import { decrypt, encrypt } from "./crypto";
import { disconnectOwnedSocialAccount, listOwnedSocialAccounts, saveAuthorizedSocialAccount, verifyOwnedSocialAccount } from "./owned-social-accounts";
import { accessTokenFor } from "./tokens";

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
Object.defineProperty(prisma, "socialAccount", {
  value: {
    findMany: async ({ where }: { where: { ownerId: string } }) => records.filter((r) => r.ownerId === where.ownerId),
    findFirst: async ({ where }: { where: { id: string; ownerId: string; disconnectedAt: null } }) =>
      records.find((r) => r.id === where.id && r.ownerId === where.ownerId && r.disconnectedAt === where.disconnectedAt) ?? null,
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
      const record = records.find((r) => r.id === where.id);
      if (!record) throw new Error("Not found");
      return { ...record };
    },
    updateMany: async ({ where, data }: { where: { id?: string; platform?: string; externalId?: string; ownerId: string | null; disconnectedAt?: null }; data: Partial<RecordType> }) => {
      const record = records.find((r) => r.ownerId === where.ownerId
        && (where.id === undefined || r.id === where.id)
        && (where.platform === undefined || r.platform === where.platform)
        && (where.externalId === undefined || r.externalId === where.externalId)
        && (where.disconnectedAt === undefined || r.disconnectedAt === where.disconnectedAt));
      if (!record) return { count: 0 };
      Object.assign(record, data);
      return { count: 1 };
    },
    create: async ({ data }: { data: RecordType }) => {
      if (records.some((r) => r.platform === data.platform && r.externalId === data.externalId)) throw new Error("Unique account belongs to another owner");
      records.push(data);
      return data;
    },
    update: async ({ where, data }: { where: { id: string; disconnectedAt: null }; data: Partial<RecordType> }) => {
      const record = records.find((r) => r.id === where.id && r.disconnectedAt === where.disconnectedAt);
      if (!record) throw new Error("Disconnected");
      Object.assign(record, data);
      return record;
    },
  },
});

async function main() {
  assert.deepEqual((await listOwnedSocialAccounts("alice")).map((a) => a.id), ["a"]);
  assert.equal(await disconnectOwnedSocialAccount("alice", "b"), false);
  assert.equal(decrypt(records[1].accessTokenEncrypted), "token-b");
  const stale = { ...records[0], createdAt: new Date(), updatedAt: new Date() };
  assert.equal(await disconnectOwnedSocialAccount("alice", "a"), true);
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
  await saveAuthorizedSocialAccount("X", "ext-staff", null, data);
  assert.equal(decrypt(records[2].accessTokenEncrypted), "new");
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
