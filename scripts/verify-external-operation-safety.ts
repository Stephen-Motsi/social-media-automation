import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { GetPrismaClientConfig } from "@prisma/client/runtime/library";

type TestResult = { name: string; error?: unknown };

function stagingUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL must explicitly point to the local staging database.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL must be a valid local staging PostgreSQL URL.");
  }
  const parameters = [...url.searchParams.entries()];
  if (
    !["postgres:", "postgresql:"].includes(url.protocol)
    || url.hostname !== "localhost"
    || url.port !== "5433"
    || url.pathname !== "/social_automation_staging"
    || url.hash
    || parameters.some(([key, value]) => key !== "schema" || value !== "public")
    || parameters.length > 1
  ) {
    throw new Error("DATABASE_URL must point only to localhost:5433/social_automation_staging with schema=public.");
  }
  // Pin the validated local host to loopback rather than resolving a hostname.
  url.hostname = "127.0.0.1";
  return url.toString();
}

async function main() {
  const url = stagingUrl();
  const { PrismaClient } = await import("@prisma/client");

  // The generated Prisma client otherwise loads its configured .env path.
  const options = {
    datasourceUrl: url,
    __internal: {
      configOverride: (config: GetPrismaClientConfig) => ({
        ...config,
        relativeEnvPaths: undefined,
        injectableEdgeEnv: undefined,
      }),
    },
  };
  const prismaOptions: Prisma.PrismaClientOptions = options;
  const prisma = new PrismaClient(prismaOptions);
  const globalForPrisma = globalThis as typeof globalThis & { prisma?: PrismaClient };
  if (globalForPrisma.prisma) throw new Error("An existing Prisma client cannot be safely reused.");
  globalForPrisma.prisma = prisma;

  const id = `external-safety-${randomUUID()}`;
  const userId = `${id}-user`;
  const accountId = `${id}-account`;
  const postId = `${id}-post`;
  const targetId = `${id}-target`;
  const subscriberId = `${id}-subscriber`;
  const campaignId = `${id}-campaign`;
  const deliveryId = `${id}-delivery`;
  const sessionName = `${id}-session`;
  const refreshKey = `${id}-refresh`;
  const results: TestResult[] = [];
  let lockAttempted = false;
  let databaseVerified = false;

  const test = async (name: string, operation: () => Promise<void>) => {
    try {
      await operation();
      results.push({ name });
    } catch (error) {
      results.push({ name, error });
    }
  };

  try {
    const [database] = await prisma.$queryRaw<{ name: string; schema: string }[]>`
      SELECT current_database() AS name, current_schema() AS schema
    `;
    assert.equal(database.name, "social_automation_staging");
    assert.equal(database.schema, "public");
    databaseVerified = true;

    const { prisma: helperPrisma } = await import("../src/lib/db");
    assert.equal(helperPrisma, prisma);
    const { withWahaSessionLock } = await import("../src/lib/waha-session-lock");
    const { claimPostTarget, claimCampaignDelivery } = await import("../src/lib/publication-claims");

    await test("WAHA lock contention and release", async () => {
      assert.equal(await prisma.wahaOperationLock.findUnique({ where: { sessionName } }), null);
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      const hold = new Promise<void>((resolve) => { release = resolve; });
      lockAttempted = true;
      const first = withWahaSessionLock(sessionName, async () => {
        entered();
        await hold;
      });
      let secondRan = false;
      try {
        await Promise.race([
          started,
          first.then(() => { throw new Error("The first lock finished before contention was tested."); }),
        ]);
        assert.ok(await prisma.wahaOperationLock.findUnique({ where: { sessionName } }));
        await assert.rejects(
          () => withWahaSessionLock(sessionName, async () => { secondRan = true; }),
          /Another WhatsApp operation is in progress or requires reconciliation/,
        );
        assert.equal(secondRan, false);
      } finally {
        release();
        await first;
      }
      assert.equal(await prisma.wahaOperationLock.findUnique({ where: { sessionName } }), null);
    });

    await test("Concurrent post target claims", async () => {
      await prisma.user.create({ data: { id: userId, email: `${id}@example.invalid` } });
      await prisma.socialAccount.create({
        data: {
          id: accountId,
          platform: "X",
          externalId: id,
          displayName: "Synthetic disconnected account",
          accessTokenEncrypted: "dummy-encrypted-access-token",
          disconnectedAt: new Date(),
          ownerId: userId,
        },
      });
      await prisma.post.create({
        data: { id: postId, authorId: userId, content: "Synthetic draft", mediaUrls: [], targetLocations: [], targetPlatforms: [] },
      });
      await prisma.postTarget.create({ data: { id: targetId, postId, accountId } });
      const claims = await Promise.all([claimPostTarget(targetId, "PENDING"), claimPostTarget(targetId, "PENDING")]);
      assert.deepEqual(claims.sort(), [false, true]);
      assert.equal((await prisma.postTarget.findUniqueOrThrow({ where: { id: targetId } })).status, "IN_FLIGHT");
    });

    await test("Concurrent campaign delivery claims", async () => {
      // Reuse the synthetic draft, but keep the test independent if its setup failed.
      if (!(await prisma.post.findUnique({ where: { id: postId } }))) {
        if (!(await prisma.user.findUnique({ where: { id: userId } }))) {
          await prisma.user.create({ data: { id: userId, email: `${id}@example.invalid` } });
        }
        await prisma.post.create({
          data: { id: postId, authorId: userId, content: "Synthetic draft", mediaUrls: [], targetLocations: [], targetPlatforms: [] },
        });
      }
      await prisma.subscriber.create({
        data: {
          id: subscriberId,
          name: "Synthetic subscriber",
          phone: id,
          status: "UNSUBSCRIBED",
          consentText: "Synthetic test data",
          consentAt: new Date(),
          manageToken: `${id}-manage`,
        },
      });
      await prisma.campaign.create({ data: { id: campaignId, advertId: postId, reason: "Synthetic test campaign" } });
      await prisma.delivery.create({ data: { id: deliveryId, campaignId, subscriberId } });
      const claims = await Promise.all([claimCampaignDelivery(deliveryId), claimCampaignDelivery(deliveryId)]);
      assert.deepEqual(claims.sort(), [false, true]);
      assert.equal((await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).status, "IN_FLIGHT");
    });

    await test("Token refresh journal persistence", async () => {
      const generation = randomUUID();
      await prisma.tokenRefreshAttempt.create({
        data: {
          key: refreshKey,
          generation,
          previousAccessToken: "dummy-encrypted-old-access",
          previousRefreshToken: "dummy-encrypted-old-refresh",
        },
      });
      const created = await prisma.tokenRefreshAttempt.findUniqueOrThrow({ where: { key: refreshKey } });
      assert.equal(created.generation, generation);
      assert.equal(created.previousAccessToken, "dummy-encrypted-old-access");
      assert.equal(created.previousRefreshToken, "dummy-encrypted-old-refresh");
      assert.equal(created.completed, false);

      const expiry = new Date("2030-01-01T00:00:00.000Z");
      await prisma.tokenRefreshAttempt.update({
        where: { key: refreshKey },
        data: {
          accessTokenEncrypted: "dummy-encrypted-new-access",
          refreshTokenEncrypted: "dummy-encrypted-new-refresh",
          tokenExpiresAt: expiry,
          completed: true,
        },
      });
      const updated = await prisma.tokenRefreshAttempt.findUniqueOrThrow({ where: { key: refreshKey } });
      assert.equal(updated.accessTokenEncrypted, "dummy-encrypted-new-access");
      assert.equal(updated.refreshTokenEncrypted, "dummy-encrypted-new-refresh");
      assert.equal(updated.tokenExpiresAt?.toISOString(), expiry.toISOString());
      assert.equal(updated.completed, true);
      await prisma.tokenRefreshAttempt.delete({ where: { key: refreshKey } });
      assert.equal(await prisma.tokenRefreshAttempt.findUnique({ where: { key: refreshKey } }), null);
    });
  } catch (error) {
    results.push({ name: "Setup", error });
  } finally {
    if (databaseVerified) {
      const cleanup: [string, () => Promise<unknown>][] = [
        ["delivery", () => prisma.delivery.deleteMany({ where: { id: deliveryId, campaignId, subscriberId } })],
        ["campaign", () => prisma.campaign.deleteMany({ where: { id: campaignId, advertId: postId } })],
        ["subscriber", () => prisma.subscriber.deleteMany({ where: { id: subscriberId, manageToken: `${id}-manage` } })],
        ["post target", () => prisma.postTarget.deleteMany({ where: { id: targetId, postId, accountId } })],
        ["post", () => prisma.post.deleteMany({ where: { id: postId, authorId: userId } })],
        ["social account", () => prisma.socialAccount.deleteMany({ where: { id: accountId, ownerId: userId, externalId: id } })],
        ["user", () => prisma.user.deleteMany({ where: { id: userId, email: `${id}@example.invalid` } })],
        ["refresh journal", () => prisma.tokenRefreshAttempt.deleteMany({ where: { key: refreshKey } })],
        ...(lockAttempted
          ? [["WAHA lock", () => prisma.wahaOperationLock.deleteMany({ where: { sessionName } })] as [string, () => Promise<unknown>]]
          : []),
      ];
      for (const [name, remove] of cleanup) {
        try {
          await remove();
        } catch (error) {
          results.push({ name: `Cleanup: ${name}`, error });
        }
      }
      try {
        const remaining = await Promise.all([
          prisma.delivery.findUnique({ where: { id: deliveryId } }),
          prisma.campaign.findUnique({ where: { id: campaignId } }),
          prisma.subscriber.findUnique({ where: { id: subscriberId } }),
          prisma.postTarget.findUnique({ where: { id: targetId } }),
          prisma.post.findUnique({ where: { id: postId } }),
          prisma.socialAccount.findUnique({ where: { id: accountId } }),
          prisma.user.findUnique({ where: { id: userId } }),
          prisma.tokenRefreshAttempt.findUnique({ where: { key: refreshKey } }),
          ...(lockAttempted ? [prisma.wahaOperationLock.findUnique({ where: { sessionName } })] : []),
        ]);
        assert.ok(remaining.every((record) => record === null), "Synthetic records remain after cleanup.");
      } catch (error) {
        results.push({ name: "Cleanup verification", error });
      }
    }
    delete globalForPrisma.prisma;
    try {
      await prisma.$disconnect();
    } catch (error) {
      results.push({ name: "Disconnect", error });
    }
  }

  for (const result of results) {
    if ("error" in result) {
      console.error(`FAIL ${result.name}:`, result.error);
    } else {
      console.log(`PASS ${result.name}`);
    }
  }
  if (results.some((result) => "error" in result)) process.exitCode = 1;
  else console.log("PASS external-operation safety verification");
}

main().catch((error: unknown) => {
  console.error("FAIL external-operation safety verification:", error);
  process.exitCode = 1;
});
