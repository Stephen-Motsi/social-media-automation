// Background worker: runs channel schedules and publishes posts to each target account.
// Run alongside the web app with `npm run worker`.
import { Worker } from "bullmq";
import type { Platform, PostFormat, SocialAccount } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CAMPAIGN_QUEUE, DELIVER_QUEUE, PUBLISH_QUEUE, redisConnection, type CampaignJob, type DeliverJob, type PublishJob } from "@/lib/queue";
import { requeueMissed } from "@/lib/dispatch";
import { deliverToHandles } from "@/lib/social-delivery";
import { sendCampaign } from "@/lib/campaigns";
import { proposeAll } from "@/lib/audience";
import { expireUnconfirmed } from "@/lib/policy/subscriptions";
import { publishPagePost, publishPageStory } from "@/lib/meta/facebook";
import { publishImage } from "@/lib/meta/instagram";
import { normalizeWahaChatId, sendWahaImage, sendWahaText, sendWahaVideo, wahaPhonePairMatches } from "@/lib/waha";
import { xCreatePost, xUploadImage } from "@/lib/x";
import { tiktokPublishPhoto } from "@/lib/tiktok";
import { loadImage, type LoadedImage } from "@/lib/media";
import { reviewContent, type Formats } from "@/lib/policy/review";
import { accessTokenFor } from "@/lib/tokens";
import { runDueChannels } from "@/lib/channels";
import { recoverWahaSessions } from "@/lib/waha-lifecycle";

type Job = {
  account: SocialAccount;
  format: PostFormat;
  recipient: string | null;
  content: string;
  imageUrl?: string;
  image: LoadedImage | null;
  whatsappTemplate?: { name: string; lang: string } | null;
  wahaSessionName?: string;
};

// Sends one target and returns the platform's ID for what was published.
async function send({ account, format, recipient, content, imageUrl, image, wahaSessionName }: Job): Promise<string> {
  const token = await accessTokenFor(account);
  switch (account.platform) {
    case "FACEBOOK":
      if (format === "STORY") {
        return (await publishPageStory({ pageId: account.externalId, pageAccessToken: token, imageUrl: imageUrl! })).id;
      }
      return (await publishPagePost({ pageId: account.externalId, pageAccessToken: token, message: content, imageUrl })).id;
    case "INSTAGRAM":
      return (
        await publishImage({
          igUserId: account.externalId,
          accessToken: token,
          imageUrl: imageUrl!,
          caption: content,
          story: format === "STORY",
        })
      ).id;
    case "WHATSAPP": {
      if (!recipient) throw new Error("WhatsApp target has no recipient");
      if (!wahaSessionName) throw new Error("No WAHA WhatsApp session is connected for this user.");
      const chatId = normalizeWahaChatId(recipient);
      const lowerUrl = imageUrl?.toLowerCase() ?? "";
      const res = lowerUrl.match(/\.(mp4|mov|webm)(?:\?|$)/)
        ? await sendWahaVideo(wahaSessionName, chatId, imageUrl!, content)
        : imageUrl
          ? await sendWahaImage(wahaSessionName, chatId, imageUrl, content)
          : await sendWahaText(wahaSessionName, chatId, content);
      const id = typeof res.id === "string" ? res.id
        : typeof (res as { _data?: { id?: string } })._data?.id === "string" ? (res as { _data: { id: string } })._data.id
        : null;
      if (!id) return JSON.stringify(res).slice(0, 200);
      return id;
    }
    case "X": {
      const mediaIds = image ? [await xUploadImage(token, image.data, image.mimeType)] : [];
      return (await xCreatePost(token, content, mediaIds)).id;
    }
    case "TIKTOK":
      return (await tiktokPublishPhoto(token, { imageUrls: [imageUrl!], caption: content })).publish_id;
  }
}

async function publish(postId: string) {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    include: { targets: { include: { account: true } }, channel: true, sourceAdvert: { select: { reviewStatus: true } } },
  });

  if (post.sourceAdvertId && post.sourceAdvert?.reviewStatus !== "APPROVED") {
    await prisma.post.update({ where: { id: postId }, data: { status: "FAILED", publishedAt: null } });
    throw new Error("Publishing blocked: the source advert has not been approved.");
  }

  // Cancelled (advert unlisted) or already done: nothing to send.
  if (post.status !== "SCHEDULED" && post.status !== "PUBLISHING") return;
  // Never early (the scheduler's safety net queues it again when it's due).
  if (post.scheduledAt && post.scheduledAt.getTime() > Date.now() + 5_000) return;

  await prisma.post.update({ where: { id: postId }, data: { status: "PUBLISHING" } });

  // Last line of defence: re-run every platform's rules for its format right before publishing,
  // even if the post passed when it was drafted (rules or content may have changed).
  let image: LoadedImage | null = null;
  let imageError: string | null = null;
  if (post.mediaUrls[0]) {
    try {
      image = await loadImage(post.mediaUrls[0]);
    } catch (err) {
      imageError = err instanceof Error ? err.message : String(err);
    }
  }
  const formats: Formats = {};
  for (const t of post.targets) formats[t.account.platform] ??= t.format;
  const platforms = Object.keys(formats) as Platform[];
  const { verdicts } = await reviewContent({ caption: post.content, image }, platforms, formats);
  await prisma.post.update({ where: { id: postId }, data: { checks: verdicts } });

  const whatsappTemplate = post.channel?.whatsappTemplate
    ? { name: post.channel.whatsappTemplate, lang: post.channel.whatsappTemplateLang }
    : null;
  const wahaSession = await prisma.whatsappSession.findUnique({
    where: { userId: post.authorId },
    select: { sessionName: true, status: true, phoneNumber: true, accountPhone: true },
  });
  if (
    wahaSession?.status === "WORKING"
    && wahaSession.phoneNumber
    && !wahaPhonePairMatches(wahaSession.phoneNumber, wahaSession.accountPhone)
  ) {
    throw new Error("Publishing blocked: the paired WhatsApp account does not match the entered phone number.");
  }

  for (const target of post.targets.filter((t) => t.status !== "PUBLISHED")) {
    const verdict = verdicts.find((v) => v.platform === target.account.platform);
    const blockers = verdict?.issues.filter((i) => i.severity === "block") ?? [];
    if (imageError || blockers.length > 0) {
      await prisma.postTarget.update({
        where: { id: target.id },
        data: {
          status: "FAILED",
          error: imageError
            ? `Image unavailable: ${imageError}`
            : `Blocked by policy check: ${blockers.map((b) => b.message).join(" ")}`,
        },
      });
      continue;
    }

    try {
      const externalPostId = await send({
        account: target.account,
        format: target.format,
        recipient: target.recipient,
        content: post.content,
        imageUrl: post.mediaUrls[0],
        image,
        whatsappTemplate,
        wahaSessionName: wahaSession?.status === "WORKING" ? wahaSession.sessionName : undefined,
      });
      await prisma.postTarget.update({
        where: { id: target.id },
        data: { status: "PUBLISHED", externalPostId, error: null },
      });
    } catch (err) {
      await prisma.postTarget.update({
        where: { id: target.id },
        data: { status: "FAILED", error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  const targets = await prisma.postTarget.findMany({ where: { postId } });
  const allOk = targets.length > 0 && targets.every((t) => t.status === "PUBLISHED");
  // Show the outcome of this run (scheduled or "Post now") on its channel
  if (post.channelId) {
    const errors = [...new Set(targets.filter((t) => t.status === "FAILED").map((t) => t.error))].filter(Boolean);
    await prisma.channel.update({
      where: { id: post.channelId },
      data: { lastRunAt: new Date(), lastError: errors.length ? errors.join(" ") : null },
    });
  }
  await prisma.post.update({
    where: { id: postId },
    data: { status: allOk ? "PUBLISHED" : "PUBLISHING", publishedAt: allOk ? new Date() : null },
  });
  if (!allOk) throw new Error(
    targets.filter((t) => t.status === "FAILED")
      .map((t) => t.error ?? "unknown platform error")
      .join("; "),
  );
}

const worker = new Worker<PublishJob>(PUBLISH_QUEUE, async (job) => {
  try {
    await publish(job.data.postId);
  } catch (err) {
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade + 1 >= attempts) {
      await prisma.post.update({ where: { id: job.data.postId }, data: { status: "FAILED", publishedAt: null } });
    }
    throw err;
  }
}, {
  connection: redisConnection(),
});
worker.on("completed", (job) => console.log(`Published post ${job.data.postId}`));
worker.on("failed", (job, err) => console.error(`Post ${job?.data.postId} failed:`, err.message));

// Audience campaigns: sent once approved (by an admin, or by publishing with auto-send), at their send time.
const campaignWorker = new Worker<CampaignJob>(CAMPAIGN_QUEUE, (job) => sendCampaign(job.data.campaignId), {
  connection: redisConnection(),
});
campaignWorker.on("completed", (job, result) => console.log(`Campaign ${job.data.campaignId} completed:`, result));
campaignWorker.on("failed", (job, err) => console.error(`Campaign ${job?.data.campaignId} failed:`, err.message));

// Subscribed adverts sent to one person's X / Instagram handles right after they subscribe.
const deliverWorker = new Worker<DeliverJob>(DELIVER_QUEUE, (job) => deliverToHandles(new Date(), job.data), {
  connection: redisConnection(),
});
deliverWorker.on("completed", (job, sent) => sent && console.log(`Sent advert ${job.data.advertId} to subscriber ${job.data.userId}'s handles`));
deliverWorker.on("failed", (job, err) => console.error(`Delivery ${job?.id} failed:`, err.message));

// Scheduler: check for due channel runs every 30 seconds.
const TICK_MS = Number(process.env.SCHEDULER_TICK_MS ?? 30_000);
let ticks = 0;
async function tick() {
  try {
    const ran = await runDueChannels();
    await recoverWahaSessions().catch(() => null);
    if (ran) console.log(`Scheduler: ${ran} channel run(s) started`);
    const handles = await deliverToHandles();
    if (handles) console.log(`Subscribers: ${handles} advert(s) sent to their X / Instagram handles`);
    const requeued = await requeueMissed();
    if (requeued) console.log(`Scheduler: ${requeued} missed send(s) queued again`);
    // Every ~10 minutes, propose any adverts that newly match subscribers (safety net; most
    // proposals happen immediately when an advert is saved or someone subscribes).
    if (ticks++ % 20 === 0) {
      const proposed = await proposeAll();
      if (proposed) console.log(`Audience: ${proposed} campaign(s) proposed for approval`);
      const expired = await expireUnconfirmed();
      if (expired) console.log(`Audience: ${expired} unconfirmed sign-up(s) expired`);
    }
  } catch (err) {
    console.error("Scheduler tick failed:", err);
  }
}
setInterval(tick, TICK_MS);
tick();

console.log("Publish worker and scheduler started");
