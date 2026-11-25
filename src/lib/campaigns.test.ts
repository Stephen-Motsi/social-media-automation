import assert from "node:assert/strict";
import { prisma } from "./db";

globalThis.fetch = async () => { throw new Error("Unexpected network request"); };
const reviewPath = require.resolve("./policy/review");
require(reviewPath);
require.cache[reviewPath]!.exports = {
  ...require.cache[reviewPath]!.exports,
  reviewContent: async () => ({ verdicts: [{ platform: "WHATSAPP", issues: [] }] }),
};
const wahaPath = require.resolve("./waha");
require(wahaPath);
let send: () => Promise<{ id: string }>;
require.cache[wahaPath]!.exports = {
  ...require.cache[wahaPath]!.exports,
  sendWahaText: async () => send(),
};

const delivery = { id: "delivery", status: "PENDING", externalId: null as string | null, error: null as string | null };
const subscriber = { id: "subscriber", status: "ACTIVE", lastSentAt: null, phone: "254712345678", name: "Test" };
const campaign = {
  id: "campaign", status: "APPROVED", sendAt: null,
  advert: { authorId: "alice", reviewStatus: "APPROVED", content: "Advert", mediaUrls: [] },
};
let failSentUpdate = false;
Object.defineProperty(prisma, "campaign", { value: {
  findUnique: async () => ({ ...campaign, deliveries: delivery.status === "PENDING" ? [{ ...delivery, subscriber }] : [] }),
  update: async ({ data }: { data: { status?: string } }) => { if (data.status) campaign.status = data.status; },
  updateMany: async ({ data }: { data: { status: string } }) => {
    if (delivery.status === "IN_FLIGHT" || (delivery.status === "PENDING" && !delivery.externalId)) return { count: 0 };
    campaign.status = data.status;
    return { count: 1 };
  },
} });
Object.defineProperty(prisma, "whatsappSession", { value: {
  findUnique: async () => ({ status: "WORKING", accountId: "254712345678@c.us", activeIdentity: "254712345678", phoneNumber: "254712345678", accountPhone: "254712345678", sessionName: "alice" }),
} });
Object.defineProperty(prisma, "delivery", { value: {
  updateMany: async ({ where, data }: { where: { status: string; externalId: null }; data: { status: string; error: string } }) => {
    if (delivery.status !== where.status || delivery.externalId !== where.externalId) return { count: 0 };
    Object.assign(delivery, data);
    return { count: 1 };
  },
  update: async ({ data }: { data: Partial<typeof delivery> }) => {
    if (failSentUpdate && data.status === "SENT") { failSentUpdate = false; throw new Error("database write failed"); }
    Object.assign(delivery, data);
  },
} });
Object.defineProperty(prisma, "subscriber", { value: { update: async () => ({}) } });
Object.defineProperty(prisma, "$transaction", { value: async (operations: Promise<unknown>[]) => Promise.all(operations) });

async function main() {
  const { sendCampaign } = await import("./campaigns");
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const finish = new Promise<void>((resolve) => { release = resolve; });
  let sends = 0;
  send = async () => { sends++; entered(); await finish; return { id: "message-id" }; };
  const first = sendCampaign("campaign");
  await started;
  const second = await sendCampaign("campaign");
  assert.ok("pending" in second && second.pending);
  release();
  assert.equal((await first).sent, 1);
  assert.equal(sends, 1);
  assert.equal(delivery.status, "SENT");
  assert.equal(delivery.externalId, "message-id");

  Object.assign(delivery, { status: "PENDING", externalId: null, error: null });
  campaign.status = "APPROVED";
  failSentUpdate = true;
  send = async () => { sends++; return { id: "possibly-sent" }; };
  assert.equal((await sendCampaign("campaign")).failed, 1);
  assert.equal(delivery.status, "IN_FLIGHT");
  assert.match(delivery.error!, /outcome unknown/);
  await sendCampaign("campaign");
  assert.equal(sends, 2);
  console.log("PASS concurrent WhatsApp campaign sends and uncertain result persistence");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
