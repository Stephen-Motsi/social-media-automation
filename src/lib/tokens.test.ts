import assert from "node:assert/strict";
import type { SocialAccount, TokenRefreshAttempt } from "@prisma/client";
import { prisma } from "./db";
import { decrypt, encrypt } from "./crypto";
import { accessTokenFor } from "./tokens";
import { connectByHandle } from "./connect-by-handle";
import { disconnectOwnedSocialAccount } from "./owned-social-accounts";

process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 2).toString("base64");
process.env.X_CLIENT_ID = "test";
process.env.X_CLIENT_SECRET = "test";
process.env.TIKTOK_CLIENT_KEY = "test";
process.env.TIKTOK_CLIENT_SECRET = "test";
process.env.TIKTOK_REFRESH_TOKEN = "old-refresh";

let record: SocialAccount;
const attempts = new Map<string, TokenRefreshAttempt>();
let journalFailures = 0;
let failCommit = false;
function reset(platform: "X" | "TIKTOK" = "X") {
  attempts.clear();
  journalFailures = 0;
  failCommit = false;
  record = {
    id: "account", ownerId: platform === "X" ? "alice" : null, platform, externalId: "provider-id",
    displayName: "Account", handle: "account", profileUrl: null, accessTokenEncrypted: encrypt("old-access"),
    refreshTokenEncrypted: encrypt("old-refresh"), tokenExpiresAt: new Date(Date.now() - 1000),
    disconnectedAt: null, createdAt: new Date(), updatedAt: new Date(),
  };
}
let lockHeld = false;
let lockAttempts = 0;
const journalClient = {
  findUnique: async ({ where }: { where: { key: string } }) => attempts.get(where.key) ?? null,
  create: async ({ data }: { data: Pick<TokenRefreshAttempt, "key" | "generation" | "previousAccessToken" | "previousRefreshToken"> }) => {
    const attempt: TokenRefreshAttempt = { ...data, accessTokenEncrypted: null, refreshTokenEncrypted: null, tokenExpiresAt: null, completed: false, createdAt: new Date() };
    if (attempts.has(data.key)) throw new Error("duplicate attempt");
    attempts.set(data.key, attempt);
    return { ...attempt };
  },
  updateMany: async ({ where, data }: { where: { key: string; generation: string }; data: Partial<TokenRefreshAttempt> }) => {
    if (journalFailures > 0) { journalFailures--; throw new Error("database unavailable"); }
    const attempt = attempts.get(where.key);
    if (!attempt || attempt.generation !== where.generation) return { count: 0 };
    Object.assign(attempt, data);
    return { count: 1 };
  },
  deleteMany: async ({ where }: { where: { key: string; generation?: string } }) => {
    const attempt = attempts.get(where.key);
    if (!attempt || (where.generation !== undefined && where.generation !== attempt.generation)) return { count: 0 };
    attempts.delete(where.key);
    return { count: 1 };
  },
};
Object.defineProperty(prisma, "tokenRefreshAttempt", { value: journalClient });
const accountClient = {
  findUniqueOrThrow: async () => ({ ...record }),
  findMany: async () => record.disconnectedAt ? [] : [{ ...record }],
  updateMany: async ({ where, data }: { where: { id?: string | { in: string[] }; ownerId?: string | null; platform?: string; disconnectedAt?: null; accessTokenEncrypted?: string; refreshTokenEncrypted?: string | null; tokenExpiresAt?: Date | null }; data: Partial<SocialAccount> }) => {
    const same = (where.id === undefined || (typeof where.id === "string" ? record.id === where.id : where.id.in.includes(record.id)))
      && (where.ownerId === undefined || record.ownerId === where.ownerId)
      && (where.platform === undefined || record.platform === where.platform)
      && (where.disconnectedAt === undefined || record.disconnectedAt === where.disconnectedAt)
      && (where.accessTokenEncrypted === undefined || record.accessTokenEncrypted === where.accessTokenEncrypted)
      && (where.refreshTokenEncrypted === undefined || record.refreshTokenEncrypted === where.refreshTokenEncrypted)
      && (where.tokenExpiresAt === undefined || record.tokenExpiresAt?.getTime() === where.tokenExpiresAt?.getTime());
    if (same) Object.assign(record, data);
    return { count: same ? 1 : 0 };
  },
};
Object.defineProperty(prisma, "socialAccount", { value: accountClient });
Object.defineProperty(prisma, "channel", { value: { findFirst: async () => ({ handle: "account" }) } });
Object.defineProperty(prisma, "$transaction", {
  value: async (operation: (tx: unknown) => Promise<unknown>) => {
    let acquired = false;
    let update: Partial<SocialAccount> | undefined;
    const deletions: string[] = [];
    try {
      const result = await operation({
        socialAccount: {
          ...accountClient,
          updateMany: async ({ where, data }: { where: { id?: string | { in: string[] }; ownerId?: string | null; platform?: string; disconnectedAt?: null; accessTokenEncrypted?: string; refreshTokenEncrypted?: string | null; tokenExpiresAt?: Date | null }; data: Partial<SocialAccount> }) => {
            const same = (where.id === undefined || (typeof where.id === "string" ? record.id === where.id : where.id.in.includes(record.id)))
              && (where.ownerId === undefined || record.ownerId === where.ownerId)
              && (where.platform === undefined || record.platform === where.platform)
              && (where.disconnectedAt === undefined || record.disconnectedAt === where.disconnectedAt)
              && (where.accessTokenEncrypted === undefined || record.accessTokenEncrypted === where.accessTokenEncrypted)
              && (where.refreshTokenEncrypted === undefined || record.refreshTokenEncrypted === where.refreshTokenEncrypted)
              && (where.tokenExpiresAt === undefined || record.tokenExpiresAt?.getTime() === where.tokenExpiresAt?.getTime());
            if (same) update = data;
            return { count: same ? 1 : 0 };
          },
        },
        tokenRefreshAttempt: {
          findUnique: journalClient.findUnique,
          deleteMany: async ({ where }: { where: { key: string | { in: string[] }; generation?: string } }) => {
            const keys = typeof where.key === "string" ? [where.key] : where.key.in;
            const matched = keys.filter((key) => {
              const attempt = attempts.get(key);
              return attempt && (where.generation === undefined || attempt.generation === where.generation);
            });
            deletions.push(...matched);
            return { count: matched.length };
          },
        },
        $queryRaw: async () => {
          lockAttempts++;
          acquired = !lockHeld;
          if (acquired) lockHeld = true;
          return [{ acquired }];
        },
      });
      if (failCommit) { failCommit = false; throw new Error("commit failed"); }
      if (update) Object.assign(record, update);
      for (const key of deletions) attempts.delete(key);
      return result;
    } finally {
      if (acquired) lockHeld = false;
    }
  },
});

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function main() {
  reset();
  let calls = 0;
  const entered = deferred();
  const resume = deferred();
  globalThis.fetch = async () => {
    calls++;
    entered.release();
    await resume.promise;
    return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 });
  };
  const first = accessTokenFor(record);
  await entered.promise;
  const second = accessTokenFor(record);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(lockAttempts >= 2, "second caller attempted the lock");
  resume.release();
  assert.deepEqual(await Promise.all([first, second]), ["new-access", "new-access"]);
  assert.equal(calls, 1);
  assert.equal(decrypt(record.refreshTokenEncrypted!), "new-refresh");

  reset();
  globalThis.fetch = async () => Response.json({ error_description: "invalid refresh" }, { status: 400 });
  await assert.rejects(() => accessTokenFor(record), /invalid refresh/);
  assert.equal(decrypt(record.accessTokenEncrypted), "old-access");
  assert.equal(decrypt(record.refreshTokenEncrypted!), "old-refresh");
  globalThis.fetch = async () => { throw new Error("must not retry ambiguous refresh"); };
  await assert.rejects(() => accessTokenFor(record), /outcome is unknown/);
  record.accessTokenEncrypted = encrypt("reauthorized");
  record.refreshTokenEncrypted = encrypt("reauthorized-refresh");
  record.tokenExpiresAt = new Date(Date.now() + 3_600_000);
  assert.equal(await accessTokenFor(record), "reauthorized");
  assert.equal(attempts.size, 0);

  reset();
  calls = 0;
  const failingStarted = deferred();
  const failingFinish = deferred();
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      failingStarted.release();
      await failingFinish.promise;
      return Response.json({ error_description: "temporary failure" }, { status: 503 });
    }
    return Response.json({ access_token: "retry-access", refresh_token: "retry-refresh", expires_in: 3600 });
  };
  const failing = accessTokenFor(record);
  await failingStarted.promise;
  const retrying = accessTokenFor(record);
  failingFinish.release();
  await assert.rejects(() => failing, /temporary failure/);
  await assert.rejects(() => retrying, /outcome is unknown/);
  assert.equal(calls, 1);

  reset();
  calls = 0;
  failCommit = true;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ access_token: "saved-access", refresh_token: "saved-refresh", expires_in: 3600 });
  };
  await assert.rejects(() => accessTokenFor(record), /commit failed/);
  assert.equal(decrypt(record.refreshTokenEncrypted!), "old-refresh");
  assert.equal(attempts.get("account:account")?.completed, true);
  assert.equal(await accessTokenFor(record), "saved-access");
  assert.equal(decrypt(record.refreshTokenEncrypted!), "saved-refresh");
  assert.equal(attempts.size, 0);
  assert.equal(calls, 1);

  reset();
  calls = 0;
  journalFailures = 3;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ access_token: "lost-access", refresh_token: "lost-refresh", expires_in: 3600 });
  };
  await assert.rejects(() => accessTokenFor(record), /Could not save rotated credentials/);
  await assert.rejects(() => accessTokenFor(record), /outcome is unknown/);
  assert.equal(calls, 1);

  reset();
  const lateStarted = deferred();
  const lateFinish = deferred();
  globalThis.fetch = async () => {
    lateStarted.release();
    await lateFinish.promise;
    return Response.json({ access_token: "late-access", refresh_token: "late-refresh", expires_in: 3600 });
  };
  const late = accessTokenFor(record);
  await lateStarted.promise;
  const oldAttempt = attempts.get("account:account")!;
  attempts.set(oldAttempt.key, { ...oldAttempt, generation: "new-generation", completed: true, accessTokenEncrypted: encrypt("new-generation-access") });
  lateFinish.release();
  await assert.rejects(() => late, /Could not save rotated credentials/);
  assert.equal(attempts.get(oldAttempt.key)?.generation, "new-generation");
  assert.equal(decrypt(attempts.get(oldAttempt.key)!.accessTokenEncrypted!), "new-generation-access");

  reset();
  const disconnectStarted = deferred();
  const disconnectFinish = deferred();
  globalThis.fetch = async () => {
    disconnectStarted.release();
    await disconnectFinish.promise;
    return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 });
  };
  const refreshingBeforeDisconnect = accessTokenFor(record);
  await disconnectStarted.promise;
  const disconnecting = disconnectOwnedSocialAccount("alice", record.id);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(record.disconnectedAt, null);
  disconnectFinish.release();
  assert.equal(await refreshingBeforeDisconnect, "new-access");
  assert.equal(await disconnecting, true);
  assert.ok(record.disconnectedAt);
  assert.equal(record.refreshTokenEncrypted, null);
  assert.equal(attempts.size, 0);

  for (const change of ["reconnect", "disconnect"] as const) {
    reset();
    const started = deferred();
    const finish = deferred();
    globalThis.fetch = async () => {
      started.release();
      await finish.promise;
      return Response.json({ access_token: "stale", refresh_token: "stale-refresh", expires_in: 3600 });
    };
    const refreshing = accessTokenFor(record);
    await started.promise;
    record.accessTokenEncrypted = encrypt(change === "reconnect" ? "reauthorized" : "");
    record.refreshTokenEncrypted = change === "reconnect" ? encrypt("reauthorized-refresh") : null;
    record.disconnectedAt = change === "disconnect" ? new Date() : null;
    finish.release();
    await assert.rejects(() => refreshing, /changed while its token was refreshing/);
    assert.equal(decrypt(record.accessTokenEncrypted), change === "reconnect" ? "reauthorized" : "");
  }

  reset("TIKTOK");
  calls = 0;
  const tikStarted = deferred();
  const tikFinish = deferred();
  globalThis.fetch = async (input) => {
    if (String(input).includes("/oauth/token/")) {
      calls++;
      tikStarted.release();
      await tikFinish.promise;
      return Response.json({ access_token: "tik-access", refresh_token: "tik-refresh", expires_in: 3600 });
    }
    return Response.json({ data: { user: { open_id: "provider-id", display_name: "Account", username: "account" } }, error: { code: "ok" } });
  };
  const tikRefresh = accessTokenFor(record);
  await tikStarted.promise;
  const connecting = connectByHandle("TIKTOK");
  tikFinish.release();
  assert.equal(await tikRefresh, "tik-access");
  assert.equal((await connecting).ok, true);
  assert.equal(calls, 1);
  assert.equal(decrypt(record.refreshTokenEncrypted!), "tik-refresh");

  reset("TIKTOK");
  globalThis.fetch = async (input) => String(input).includes("/oauth/token/")
    ? Response.json({ access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600 })
    : Response.json({ error: { code: "unavailable", message: "Unavailable" } }, { status: 503 });
  assert.equal((await connectByHandle("TIKTOK")).ok, false);
  assert.equal(decrypt(record.refreshTokenEncrypted!), "rotated-refresh");
  console.log("PASS concurrent refreshes, journal recovery, failures, reauthorization and TikTok coordination");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
