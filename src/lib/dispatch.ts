import { prisma } from "@/lib/db";
import { queueCampaign, schedulePost } from "@/lib/queue";

// Safety net run by the worker: anything due that isn't in the job queue (Redis was down or
// restarted, or the app couldn't reach it when it was scheduled) is queued again. Jobs that are
// already waiting are left alone, so this never sends twice.
const GRACE_MS = 60_000;

export async function requeueMissed(now = new Date()) {
  const before = new Date(now.getTime() - GRACE_MS);
  const [posts, campaigns] = await Promise.all([
    prisma.post.findMany({ where: { status: { in: ["SCHEDULED", "PUBLISHING"] }, scheduledAt: { lte: before }, targets: { some: { status: { in: ["PENDING", "FAILED"] } } } }, select: { id: true } }),
    prisma.campaign.findMany({
      where: { status: { in: ["APPROVED", "SENDING"] }, approvedAt: { lte: before }, OR: [{ sendAt: null }, { sendAt: { lte: before } }], deliveries: { some: { status: "PENDING", externalId: null } } },
      select: { id: true },
    }),
  ]);
  for (const p of posts) await schedulePost(p.id);
  for (const c of campaigns) await queueCampaign(c.id);
  return posts.length + campaigns.length;
}
