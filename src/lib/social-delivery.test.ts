import assert from "node:assert/strict";
import { prisma } from "./db";
import { encrypt } from "./crypto";
import { deliverToHandles } from "./social-delivery";

process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");

const accounts: { id: string; platform: string; ownerId: string | null; handle: string; displayName: string; externalId: string; disconnectedAt: Date | null; accessTokenEncrypted: string; refreshTokenEncrypted: string | null; tokenExpiresAt: Date | null }[] = [
  { id: "bob-x", platform: "X", ownerId: "bob", handle: "bob", displayName: "Bob", externalId: "bob", disconnectedAt: null, accessTokenEncrypted: encrypt("bob-token"), refreshTokenEncrypted: null, tokenExpiresAt: null },
  { id: "shared-x", platform: "X", ownerId: null, handle: "staff", displayName: "Staff", externalId: "staff", disconnectedAt: null, accessTokenEncrypted: encrypt("staff-token"), refreshTokenEncrypted: null, tokenExpiresAt: null },
  { id: "alice-ig", platform: "INSTAGRAM", ownerId: "alice", handle: "alice", displayName: "Alice", externalId: "alice", disconnectedAt: null, accessTokenEncrypted: encrypt("alice-ig-token"), refreshTokenEncrypted: null, tokenExpiresAt: null },
  { id: "bob-ig", platform: "INSTAGRAM", ownerId: "bob", handle: "bob", displayName: "Bob", externalId: "bob", disconnectedAt: null, accessTokenEncrypted: encrypt("bob-ig-token"), refreshTokenEncrypted: null, tokenExpiresAt: null },
];
const channels = [
  { platform: "X", ownerId: "alice", handle: "alice" },
  { platform: "X", ownerId: null, handle: "staff" },
  { platform: "INSTAGRAM", ownerId: "alice", handle: "alice" },
];
function delivery(id: string, authorId: string, role: "USER" | "ADMIN", platform: "X" | "INSTAGRAM") {
  return {
    id, advertId: `${id}-advert`, platform, handle: "subscriber", attempts: 0, status: "PENDING", updatedAt: new Date(),
    advert: { id: `${id}-advert`, authorId, author: { id: authorId, role }, reviewStatus: "APPROVED", listedAt: new Date(), title: "Advert", content: "Hello" },
    user: { disabledAt: null, socials: [{ platform, handle: "subscriber" }], subscriptions: [{ advertId: `${id}-advert`, platform }] },
  };
}
let due = [delivery("alice", "alice", "USER", "X")];
const updates: { id: string; data: Record<string, unknown> }[] = [];
let failSentUpdate = false;
const target = { status: "PUBLISHED", accountId: "bob-ig", account: accounts[3], post: { sourceAdvertId: "alice-ig-advert", authorId: "alice" }, externalPostId: "bob-post" };
Object.defineProperty(prisma, "advertSubscription", { value: { findMany: async () => [] } });
Object.defineProperty(prisma, "notification", { value: { create: async () => ({}) } });
Object.defineProperty(prisma, "tokenRefreshAttempt", { value: { findUnique: async () => null } });
Object.defineProperty(prisma, "socialDelivery", { value: {
  findMany: async () => due.filter((d) => d.status === "PENDING" || d.status === "FAILED").map((d) => ({ ...d })),
  updateMany: async ({ where, data }: { where: { id: string; status: string; attempts: number; updatedAt: Date }; data: { status: string } }) => {
    const item = due.find((d) => d.id === where.id && d.status === where.status && d.attempts === where.attempts && d.updatedAt.getTime() === where.updatedAt.getTime());
    if (!item) return { count: 0 };
    item.status = data.status;
    return { count: 1 };
  },
  update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    if (failSentUpdate && data.status === "SENT") { failSentUpdate = false; throw new Error("database write failed"); }
    updates.push({ id: where.id, data });
    const item = due.find((d) => d.id === where.id);
    assert.ok(item);
    if (typeof data.status === "string") item.status = data.status;
    if (typeof data.attempts === "object" && data.attempts !== null && "increment" in data.attempts) item.attempts += Number(data.attempts.increment);
  },
} });
Object.defineProperty(prisma, "channel", { value: {
  findFirst: async ({ where }: { where: { platform: string; ownerId: string | null } }) =>
    channels.find((channel) => channel.platform === where.platform && channel.ownerId === where.ownerId) ?? null,
} });
Object.defineProperty(prisma, "socialAccount", { value: {
  findMany: async ({ where }: { where: { platform: string; ownerId: string | null; disconnectedAt: null } }) =>
    accounts.filter((account) => account.platform === where.platform && account.ownerId === where.ownerId && account.disconnectedAt === where.disconnectedAt),
  findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
    const account = accounts.find((item) => item.id === where.id);
    assert.ok(account);
    return account;
  },
} });
Object.defineProperty(prisma, "postTarget", { value: {
  findFirst: async ({ where }: { where: { status: string; accountId: string; account: { disconnectedAt: null }; post: { sourceAdvertId: string; authorId: string } } }) =>
    target.status === where.status && target.accountId === where.accountId && target.account.disconnectedAt === where.account.disconnectedAt
      && target.post.sourceAdvertId === where.post.sourceAdvertId && target.post.authorId === where.post.authorId ? target : null,
} });
const authorization: string[] = [];
globalThis.fetch = async (input, init) => {
  authorization.push(new Headers(init?.headers).get("authorization") ?? "");
  const path = new URL(String(input)).pathname;
  if (path.includes("/users/by/username/")) return Response.json({ data: { id: "subscriber-id", username: "subscriber" } });
  if (path.includes("/dm_conversations/")) return Response.json({ data: { dm_event_id: "sent" } });
  if (path.endsWith("/comments")) return Response.json({ id: "comment" });
  throw new Error(`Unexpected provider request: ${path}`);
};

async function main() {
  assert.equal(await deliverToHandles(), 0);
  assert.equal(authorization.length, 0);
  assert.match(String(updates.at(-1)?.data.error), /isn't connected/);

  accounts.push({ ...accounts[0], id: "alice-x", ownerId: "alice", handle: "alice", externalId: "alice", accessTokenEncrypted: encrypt("alice-token") });
  due = [delivery("alice", "alice", "USER", "X"), delivery("staff", "staff", "ADMIN", "X")];
  assert.equal(await deliverToHandles(), 2);
  assert.deepEqual(authorization, ["Bearer alice-token", "Bearer alice-token", "Bearer staff-token", "Bearer staff-token"]);

  authorization.length = 0;
  due = [delivery("alice-ig", "alice", "USER", "INSTAGRAM")];
  assert.equal(await deliverToHandles(), 0);
  assert.equal(authorization.length, 0);
  assert.match(String(updates.at(-1)?.data.error), /Waiting for the advert/);

  target.accountId = "alice-ig";
  target.account = accounts[2];
  target.post.authorId = "bob";
  assert.equal(await deliverToHandles(), 0);
  assert.equal(authorization.length, 0);
  target.post.authorId = "alice";
  assert.equal(await deliverToHandles(), 1);
  assert.deepEqual(authorization, ["Bearer alice-ig-token"]);

  authorization.length = 0;
  accounts.find((account) => account.id === "alice-x")!.disconnectedAt = new Date();
  due = [delivery("alice", "alice", "USER", "X")];
  assert.equal(await deliverToHandles(), 0);
  assert.equal(authorization.length, 0);

  accounts.find((account) => account.id === "alice-x")!.disconnectedAt = null;
  due = [delivery("race", "alice", "USER", "X")];
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const finish = new Promise<void>((resolve) => { release = resolve; });
  let sends = 0;
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.includes("/users/by/username/")) return Response.json({ data: { id: "subscriber-id" } });
    if (path.includes("/dm_conversations/")) {
      sends++;
      entered();
      await finish;
      return Response.json({ data: { dm_event_id: "sent" } });
    }
    throw new Error("Unexpected request");
  };
  const first = deliverToHandles();
  await started;
  assert.equal(await deliverToHandles(), 0);
  release();
  assert.equal(await first, 1);
  assert.equal(sends, 1);
  assert.equal(due[0].status, "SENT");

  due = [delivery("uncertain", "alice", "USER", "X")];
  failSentUpdate = true;
  assert.equal(await deliverToHandles(), 0);
  assert.equal(due[0].status, "IN_FLIGHT");
  assert.match(String(updates.at(-1)?.data.error), /outcome unknown/);
  assert.equal(await deliverToHandles(), 0);
  assert.equal(sends, 2);
  console.log("PASS social delivery isolation, concurrency and uncertain outcome");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
