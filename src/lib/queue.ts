import { Queue } from "bullmq";
import IORedis from "ioredis";

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

// Enqueue a post to publish at `scheduledAt` (or immediately if omitted/past).
export async function schedulePost(postId: string, scheduledAt?: Date | null) {
  const delay = scheduledAt ? Math.max(0, scheduledAt.getTime() - Date.now()) : 0;
  await publishQueue().add(
    "publish",
    { postId },
    { jobId: postId, delay, attempts: 3, backoff: { type: "exponential", delay: 60_000 } },
  );
}
