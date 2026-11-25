import assert from "node:assert/strict";
import { prisma } from "./db";
import { claimCampaignDelivery, claimPostTarget, publishClaimedTarget } from "./publication-claims";

const target = { status: "PENDING", externalPostId: null as string | null, error: null as string | null };
const delivery = { status: "PENDING", externalId: null as string | null };
let failPublishedUpdate = false;
Object.defineProperty(prisma, "postTarget", { value: {
  updateMany: async ({ where, data }: { where: { status: string }; data: { status: string; error: string } }) => {
    if (target.status !== where.status) return { count: 0 };
    Object.assign(target, data);
    return { count: 1 };
  },
  update: async ({ data }: { data: Partial<typeof target> }) => {
    if (failPublishedUpdate && data.status === "PUBLISHED") { failPublishedUpdate = false; throw new Error("database unavailable"); }
    Object.assign(target, data);
  },
} });
Object.defineProperty(prisma, "delivery", { value: {
  updateMany: async ({ where, data }: { where: { status: string; externalId: null }; data: { status: string } }) => {
    if (delivery.status !== where.status || delivery.externalId !== where.externalId) return { count: 0 };
    Object.assign(delivery, data);
    return { count: 1 };
  },
} });

async function main() {
  assert.deepEqual((await Promise.all([claimPostTarget("target", "PENDING"), claimPostTarget("target", "PENDING")])).sort(), [false, true]);
  let sends = 0;
  await publishClaimedTarget("target", async () => { sends++; return "provider-id"; });
  assert.equal(target.status, "PUBLISHED");
  assert.equal(target.externalPostId, "provider-id");
  assert.equal(await claimPostTarget("target", "PUBLISHED"), false);
  assert.equal(sends, 1);

  Object.assign(target, { status: "PENDING", externalPostId: null, error: null });
  assert.equal(await claimPostTarget("target", "PENDING"), true);
  failPublishedUpdate = true;
  await publishClaimedTarget("target", async () => { sends++; return "possibly-published"; });
  assert.equal(target.status, "IN_FLIGHT");
  assert.match(target.error!, /outcome unknown/);
  assert.equal(await claimPostTarget("target", "PENDING"), false);
  assert.equal(await claimPostTarget("target", "IN_FLIGHT"), false);

  Object.assign(target, { status: "PENDING", externalPostId: null, error: null });
  assert.equal(await claimPostTarget("target", "PENDING"), true);
  await publishClaimedTarget("target", async () => { throw new Error("timeout"); });
  assert.equal(target.status, "IN_FLIGHT");
  assert.match(target.error!, /timeout/);

  assert.deepEqual((await Promise.all([claimCampaignDelivery("delivery"), claimCampaignDelivery("delivery")])).sort(), [false, true]);
  assert.equal(delivery.status, "IN_FLIGHT");
  assert.equal(await claimCampaignDelivery("delivery"), false);
  console.log("PASS concurrent post and campaign claims, provider timeout and failed result persistence");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
