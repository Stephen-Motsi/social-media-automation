// Background worker: publishes scheduled posts to each target account.
// Run alongside the web app with `npm run worker`.
import { Worker } from "bullmq";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { PUBLISH_QUEUE, redisConnection, type PublishJob } from "@/lib/queue";
import { publishPagePost } from "@/lib/meta/facebook";
import { publishImage } from "@/lib/meta/instagram";
import { sendText } from "@/lib/meta/whatsapp";
import { loadImage, type LoadedImage } from "@/lib/media";
import { reviewContent } from "@/lib/policy/review";

async function publish(postId: string) {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    include: { targets: { include: { account: true } } },
  });

  await prisma.post.update({ where: { id: postId }, data: { status: "PUBLISHING" } });

  // Last line of defence: re-run every platform's rules right before publishing,
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
  const platformsInPost = [...new Set(post.targets.map((t) => t.account.platform))];
  const { verdicts } = await reviewContent({ caption: post.content, image }, platformsInPost);
  await prisma.post.update({ where: { id: postId }, data: { checks: verdicts } });

  for (const target of post.targets.filter((t) => t.status !== "PUBLISHED")) {
    const { account } = target;
    const verdict = verdicts.find((v) => v.platform === account.platform);
    const blockers = verdict?.issues.filter((i) => i.severity === "block") ?? [];
    if (imageError || blockers.length > 0) {
      await prisma.postTarget.update({
        where: { id: target.id },
        data: {
          status: "FAILED",
          error: imageError ? `Image unavailable: ${imageError}` : `Blocked by policy check: ${blockers.map((b) => b.message).join(" ")}`,
        },
      });
      continue;
    }

    const token = decrypt(account.accessTokenEncrypted);
    try {
      let externalPostId: string;
      switch (account.platform) {
        case "FACEBOOK":
          externalPostId = (
            await publishPagePost({
              pageId: account.externalId,
              pageAccessToken: token,
              message: post.content,
              imageUrl: post.mediaUrls[0],
            })
          ).id;
          break;
        case "INSTAGRAM":
          if (!post.mediaUrls[0]) throw new Error("Instagram posts require an image");
          externalPostId = (
            await publishImage({
              igUserId: account.externalId,
              accessToken: token,
              imageUrl: post.mediaUrls[0],
              caption: post.content,
            })
          ).id;
          break;
        case "WHATSAPP":
          if (!target.recipient) throw new Error("WhatsApp target has no recipient");
          externalPostId = (
            await sendText({
              phoneNumberId: account.externalId,
              accessToken: token,
              to: target.recipient,
              body: post.content,
            })
          ).messages[0].id;
          break;
      }
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
  const allOk = targets.every((t) => t.status === "PUBLISHED");
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
console.log("Publish worker started");
