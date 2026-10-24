"use server";

import { revalidatePath } from "next/cache";
import type { Platform, PostFormat } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logActivity, requireStaff } from "@/lib/session";
import { schedulePost } from "@/lib/queue";
import { formatWhen, QueueUnavailable, reasonFor } from "@/lib/errors";
import { displayHandle, handleMatches } from "@/lib/handles";
import { publicMediaUrl } from "@/lib/media";
import { reviewContent, type Formats } from "@/lib/policy/review";
import { formatSupport, platformOrder, platformRules } from "@/lib/policy/rules";
import { generateAdvertImage, type ImageResult } from "@/lib/advert-images";
import type { PlatformOutcome } from "@/lib/adverts";

// Posts and stories for your own followers: published on your accounts at a set time
// (or now). Separate from adverts, which users subscribe to.

export type ScheduleState = { ok: true; outcomes: PlatformOutcome[]; scheduled: boolean } | { ok: false; error: string };

const WHATSAPP_REASON = "WhatsApp Status can't be posted by any business tool: Meta's API doesn't offer it. To reach people on WhatsApp, publish an advert and they get it on their number.";

// The platform whose rules shape the photo: Instagram's are the strictest for posts.
const shapePlatform = (selected: Platform[]) => (selected.includes("INSTAGRAM") ? "INSTAGRAM" : selected[0] ?? "FACEBOOK");

export async function generatePostImage(prompt: string, selected: Platform[], format: PostFormat): Promise<ImageResult> {
  const viewer = await requireStaff();
  try {
    return await generateAdvertImage(viewer.id, prompt, shapePlatform(selected), format);
  } catch (err) {
    return { ok: false, error: reasonFor(err) };
  }
}

export async function schedulePostAction(input: {
  platforms: Platform[];
  format: PostFormat;
  caption: string;
  mediaId?: string | null;
  sendAt?: string | null;
}): Promise<ScheduleState> {
  const viewer = await requireStaff();
  try {
    const caption = input.caption.trim();
    const chosen = platformOrder.filter((p) => input.platforms.includes(p));
    if (chosen.length === 0) return { ok: false, error: "choose at least one platform." };
    if (!caption && !input.mediaId) return { ok: false, error: "add a caption or a photo." };
    const sendAt = input.sendAt ? new Date(input.sendAt) : null;
    if (sendAt && Number.isNaN(sendAt.getTime())) return { ok: false, error: "that time isn't a valid date." };
    if (sendAt && sendAt.getTime() < Date.now() - 5 * 60_000) return { ok: false, error: "that time is in the past. Pick a later time or choose Now." };
    const when = sendAt && sendAt > new Date() ? sendAt : null;

    const asset = input.mediaId ? await prisma.mediaAsset.findUnique({ where: { id: input.mediaId } }) : null;
    if (input.mediaId && !asset) return { ok: false, error: "that photo no longer exists. Create or upload it again." };
    if (asset?.blocked) return { ok: false, error: "that photo breaks the content rules on every platform. Use another." };

    const outcomes: PlatformOutcome[] = [];
    const ready: { platform: Platform; accountIds: string[] }[] = [];
    const supported = chosen.filter((p) => {
      const support = formatSupport[p][input.format];
      if (p === "WHATSAPP") outcomes.push({ platform: p, ok: false, message: `Not posted on WhatsApp: ${WHATSAPP_REASON}` });
      else if (!support.supported) outcomes.push({ platform: p, ok: false, message: `Not posted on ${platformRules[p].name}: ${support.reason}` });
      else return true;
      return false;
    });

    // Each platform's rules for this format, checked now and again by the worker before publishing.
    const formats: Formats = Object.fromEntries(supported.map((p) => [p, input.format]));
    const { verdicts } = supported.length
      ? await reviewContent({ caption, image: asset, prompt: asset?.prompt ?? undefined }, supported, formats)
      : { verdicts: [] };
    for (const platform of supported) {
      const name = platformRules[platform].name;
      const blockers = verdicts.find((v) => v.platform === platform)?.issues.filter((i) => i.severity === "block") ?? [];
      if (blockers.length) {
        outcomes.push({ platform, ok: false, message: `Not posted on ${name}: ${blockers.map((b) => b.message).join(" ")}` });
        continue;
      }
      const channel = await prisma.channel.findUnique({ where: { platform } });
      const accounts = (await prisma.socialAccount.findMany({ where: { platform } })).filter((a) => handleMatches(platform, channel?.handle, a));
      if (accounts.length === 0) {
        const who = channel?.handle ? displayHandle(platform, channel.handle) : `your ${name} account`;
        outcomes.push({ platform, ok: false, message: `Not posted on ${name}: ${who} isn't connected. Connect it in Settings on Channels.` });
        continue;
      }
      ready.push({ platform, accountIds: accounts.map((a) => a.id) });
    }
    if (ready.length === 0) return { ok: true, outcomes, scheduled: false };

    const post = await prisma.post.create({
      data: {
        content: caption,
        mediaUrls: asset ? [publicMediaUrl(asset.id)] : [],
        status: "SCHEDULED",
        scheduledAt: when ?? new Date(),
        checks: verdicts,
        authorId: viewer.id,
        targets: { create: ready.flatMap((r) => r.accountIds.map((accountId) => ({ accountId, format: input.format }))) },
      },
    });
    const kind = input.format === "STORY" ? "Story" : "Post";
    let queueProblem: string | null = null;
    try {
      await schedulePost(post.id, when);
    } catch (err) {
      if (!(err instanceof QueueUnavailable)) throw err;
      queueProblem = err.message;
    }
    for (const r of ready) {
      const name = platformRules[r.platform].name;
      outcomes.push(
        queueProblem
          ? { platform: r.platform, ok: false, message: `Saved for ${name}, but ${queueProblem}` }
          : { platform: r.platform, ok: true, message: `${kind} ${when ? `scheduled on ${name} for ${formatWhen(when)}` : `posting on ${name} now`}.` },
      );
    }
    await logActivity(viewer.id, "POST_SCHEDULED", { post: post.id, platforms: ready.map((r) => r.platform), format: input.format, at: when?.toISOString() ?? "now" }).catch(() => null);
    revalidatePath("/posts");
    outcomes.sort((a, b) => platformOrder.indexOf(a.platform) - platformOrder.indexOf(b.platform));
    return { ok: true, outcomes, scheduled: true };
  } catch (err) {
    return { ok: false, error: reasonFor(err) };
  }
}

export async function cancelPost(postId: string): Promise<{ ok?: boolean; error?: string }> {
  await requireStaff();
  try {
    const res = await prisma.post.updateMany({ where: { id: postId, status: "SCHEDULED" }, data: { status: "FAILED" } });
    if (res.count === 0) return { error: "It's already gone out (or was cancelled)." };
    await prisma.postTarget.updateMany({ where: { postId, status: "PENDING" }, data: { status: "FAILED", error: "Cancelled." } });
    revalidatePath("/posts");
    return { ok: true };
  } catch (err) {
    return { error: `Not cancelled: ${reasonFor(err)}` };
  }
}
