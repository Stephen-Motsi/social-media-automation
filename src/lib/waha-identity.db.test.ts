import assert from "node:assert/strict";

async function main() {
  const testUrl = process.env.WAHA_IDENTITY_TEST_DATABASE_URL;
  if (!testUrl) throw new Error("Set WAHA_IDENTITY_TEST_DATABASE_URL to an isolated local test database.");
  const url = new URL(testUrl);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/waha_identity_test") {
    throw new Error("The test database must be local and named waha_identity_test.");
  }
  process.env.DATABASE_URL = testUrl;
  const { prisma } = await import("./db");
  const { claimWahaIdentity, WAHA_IDENTITY_CONFLICT } = await import("./waha-identity");
  try {
    await prisma.$executeRaw`
      CREATE TABLE "WhatsappSession" (
        "id" TEXT PRIMARY KEY, "userId" TEXT UNIQUE NOT NULL, "status" TEXT NOT NULL,
        "activeIdentity" TEXT UNIQUE CHECK ("activeIdentity" IS NULL OR "activeIdentity" ~ '^[0-9]{8,15}$'),
        "accountId" TEXT, "accountPhone" TEXT, "accountInfo" JSONB, "accountPushName" TEXT,
        "accountName" TEXT, "lastStatusAt" TIMESTAMP(3), "lastError" TEXT,
        "recoveryAttemptCount" INTEGER NOT NULL DEFAULT 0, "lastRecoveryAt" TIMESTAMP(3),
        "pairingCode" TEXT, "pairingCodeExpiresAt" TIMESTAMP(3), "qrData" TEXT,
        "qrGeneratedAt" TIMESTAMP(3), "qrExpiresAt" TIMESTAMP(3),
        "stateVersion" INTEGER NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK ("status" <> 'WORKING' OR "activeIdentity" IS NOT NULL),
        CHECK ("activeIdentity" IS NULL OR (
          "accountId" IS NOT NULL AND (lower(trim("accountId")) ~ '^[0-9]{8,15}(:[0-9]+)?@(c[.]us|s[.]whatsapp[.]net)$'
            OR trim("accountId") ~ '^[0-9]{8,15}$')
          AND substring(trim("accountId") FROM '^([0-9]{8,15})') = "activeIdentity"
        ))
      )
    `;
    await prisma.$executeRaw`INSERT INTO "WhatsappSession" ("id", "userId", "status") VALUES ('a', 'alice', 'STARTING'), ('b', 'bob', 'STARTING')`;
    await assert.rejects(() => prisma.$executeRaw`UPDATE "WhatsappSession" SET "status" = 'WORKING' WHERE "userId" = 'alice'`);
    await assert.rejects(() => prisma.$executeRaw`UPDATE "WhatsappSession" SET "activeIdentity" = '111111111', "accountId" = '222222222@c.us' WHERE "userId" = 'alice'`);
    const [alice, bob] = await Promise.all([
      claimWahaIdentity("alice", 0, { id: "254712345678@c.us" }),
      claimWahaIdentity("bob", 0, { id: "254712345678:4@s.whatsapp.net" }),
    ]);
    assert.equal(Number(alice.ok) + Number(bob.ok), 1);
    const loser = alice.ok ? bob : alice;
    assert.equal(loser.ok, false);
    if (!loser.ok) assert.equal(loser.error, WAHA_IDENTITY_CONFLICT);
    const winnerId = alice.ok ? "alice" : "bob";
    const loserId = alice.ok ? "bob" : "alice";
    assert.equal((await claimWahaIdentity(winnerId, 1, { id: "254712345678@c.us" })).ok, true);
    const rows = await prisma.$queryRaw<{ userId: string; activeIdentity: string | null }[]>`
      SELECT "userId", "activeIdentity" FROM "WhatsappSession" ORDER BY "userId"
    `;
    assert.equal(rows.filter((row) => row.activeIdentity === "254712345678").length, 1);
    await prisma.$executeRaw`UPDATE "WhatsappSession" SET "activeIdentity" = NULL, "status" = 'STOPPED', "stateVersion" = "stateVersion" + 1 WHERE "userId" = ${winnerId}`;
    assert.equal((await claimWahaIdentity(winnerId, 2, { id: "111111111@c.us" })).ok, false);
    assert.equal((await claimWahaIdentity(loserId, 0, { id: "254712345678@c.us" })).ok, true);
    assert.equal((await claimWahaIdentity(winnerId, 3, { id: "254712345678@c.us" })).ok, false);
    console.log("PASS PostgreSQL concurrent claims, duplicate rejection and reconnect after disconnect");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
