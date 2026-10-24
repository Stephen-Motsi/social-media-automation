// Background worker: runs channel schedules and publishes posts to each target account.
// Run alongside the web app with `npm run worker`.
import { Worker } from "bullmq";
import type { Platform, PostFormat, SocialAccount } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CAMPAIGN_QUEUE, PUBLISH_QUEUE, redisConnection, type CampaignJob, type PublishJob } from "@/lib/queue";
import { requeueMissed } from "@/lib/dispatch";
import { deliverToHandles } from "@/lib/social-delivery";
import { sendCampaign } from "@/lib/campaigns";
import { proposeAll } from "@/lib/audience";
import { expireUnconfirmed } from "@/lib/policy/subscriptions";
import { publishPagePost, publishPageStory } from "@/lib/meta/facebook";
import { publishImage } from "@/lib/meta/instagram";
import { sendImage, sendTemplate, sendText } from "@/lib/meta/whatsapp";
import { xCreatePost, xUploadImage } from "@/lib/x";
import { tiktokPublishPhoto } from "@/lib/tiktok";
import { loadImage, type LoadedImage } from "@/lib/media";
import { reviewContent, type Formats } from "@/lib/policy/review";
import { accessTokenFor } from "@/lib/tokens";
import { runDueChannels } from "@/lib/channels";

type Job = {
  account: SocialAccount;
  format: PostFormat;
  recipient: string | null;
  content: string;
  imageUrl?: string;
  image: LoadedImage | null;
  whatsappTemplate?: { name: string; lang: string } | null;
};

// Sends one target and returns the platform's ID for what was published.
async function send({ account, format, recipient, content, imageUrl, image, whatsappTemplate }: Job): Promise<string> {
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
      const res = whatsappTemplate
        ? await sendTemplate({
            phoneNumberId: account.externalId,
            accessToken: token,
            to: recipient,
            templateName: whatsappTemplate.name,
            languageCode: whatsappTemplate.lang,
          })
        : imageUrl
          ? await sendImage({ phoneNumberId: account.externalId, accessToken: token, to: recipient, imageUrl, caption: content })
          : await sendText({ phoneNumberId: account.externalId, accessToken: token, to: recipient, body: content });
      return res.messages[0].id;
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
    include: { targets: { include: { account: true } }, channel: true },
  });

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
    data: { status: allOk ? "PUBLISHED" : "FAILED", publishedAt: allOk ? new Date() : null },
  });
}

const worker = new Worker<PublishJob>(PUBLISH_QUEUE, (job) => publish(job.data.postId), {
  connection: redisConnection(),
});
worker.on("completed", (job) => console.log(`Published post ${job.data.postId}`));
worker.on("failed", (job, err) => console.error(`Post ${job?.data.postId} failed:`, err.message));

// Audience campaigns: sent once approved (by an admin, or by publishing with auto-send), at their send time.
const campaignWorker = new Worker<CampaignJob>(CAMPAIGN_QUEUE, (job) => sendCampaign(job.data.campaignId), {
  connection: redisConnection(),
});
campaignWorker.on("completed", (job) => console.log(`Campaign ${job.data.campaignId} sent`));
campaignWorker.on("failed", (job, err) => console.error(`Campaign ${job?.data.campaignId} failed:`, err.message));

// Scheduler: check for due channel runs every 30 seconds.
const TICK_MS = Number(process.env.SCHEDULER_TICK_MS ?? 30_000);
let ticks = 0;
async function tick() {
  try {
    const ran = await runDueChannels();
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
