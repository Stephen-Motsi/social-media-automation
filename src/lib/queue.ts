import { Queue } from "bullmq";
import IORedis from "ioredis";
import { QueueUnavailable, withTimeout } from "@/lib/errors";

export const PUBLISH_QUEUE = "publish-post";

export type PublishJob = { postId: string };

export function redisConnection() {
  return new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null, // required by BullMQ
  });
}

let queue: Queue<PublishJob> | undefined;

export function publishQueue() {
  queue ??= new Queue<PublishJob>(PUBLISH_QUEUE, { connection: redisConnection() });
  return queue;
}

const QUEUE_TIMEOUT_MS = 5_000;

// Adds a job, replacing a finished one with the same ID (so a missed send can be queued again).
// Throws QueueUnavailable rather than waiting forever when Redis is down.
async function addJob<T>(queue: Queue<T>, name: string, data: T, jobId: string, at?: Date | null) {
  const delay = at ? Math.max(0, at.getTime() - Date.now()) : 0;
  const add = async () => {
    const old = await queue.getJob(jobId);
    if (old) {
      const state = await old.getState();
      if (state !== "completed" && state !== "failed") return; // already waiting or running
      await old.remove();
    }
    // @ts-expect-error BullMQ's generic name typing
    await queue.add(name, data, { jobId, delay, attempts: 3, backoff: { type: "exponential", delay: 60_000 } });
  };
  await withTimeout(add(), QUEUE_TIMEOUT_MS, () => new QueueUnavailable());
}

// Enqueue a post to publish at `scheduledAt` (or immediately if omitted/past).
export async function schedulePost(postId: string, scheduledAt?: Date | null) {
  await addJob(publishQueue(), "publish", { postId }, postId, scheduledAt);
}

// Audience campaigns: one job per approved campaign.
export const CAMPAIGN_QUEUE = "send-campaign";
export type CampaignJob = { campaignId: string };

let campaignQueue: Queue<CampaignJob> | undefined;

// Sends at `sendAt` (or straight away if omitted/past).
export async function queueCampaign(campaignId: string, sendAt?: Date | null) {
  campaignQueue ??= new Queue<CampaignJob>(CAMPAIGN_QUEUE, { connection: redisConnection() });
  await addJob(campaignQueue, "send", { campaignId }, `campaign-${campaignId}`, sendAt);
}

// Sending a subscribed advert to one person's handles, straight after they subscribe.
export const DELIVER_QUEUE = "deliver-subscription";
export type DeliverJob = { advertId: string; userId: string };

let deliverQueue: Queue<DeliverJob> | undefined;

export async function queueDelivery(advertId: string, userId: string, at?: Date | null) {
  deliverQueue ??= new Queue<DeliverJob>(DELIVER_QUEUE, { connection: redisConnection() });
  await addJob(deliverQueue, "deliver", { advertId, userId }, `deliver-${advertId}-${userId}`, at);
}
