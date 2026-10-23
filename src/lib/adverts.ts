import type { Platform } from "@prisma/client";
import { prisma } from "@/lib/db";
import { displayHandle, handleMatches, profileUrl } from "@/lib/handles";
import { schedulePost } from "@/lib/queue";
import { proposeCampaign } from "@/lib/audience";

// Adverts the admin defines (title, about, topics, target platforms, image, caption) and lists
// for users, who subscribe to an advert per platform handle.

export type AdvertPlatform = { platform: Platform; handle: string; url: string | null };

// The platforms an advert targets that have a social container with a handle (what users can pick).
export async function advertPlatforms(targetPlatforms: Platform[]): Promise<AdvertPlatform[]> {
  if (targetPlatforms.length === 0) return [];
  const channels = await prisma.channel.findMany({ where: { platform: { in: targetPlatforms } } });
  return targetPlatforms.flatMap((platform) => {
    const c = channels.find((ch) => ch.platform === platform);
    return c?.handle ? [{ platform, handle: displayHandle(platform, c.handle), url: profileUrl(platform, c.handle) }] : [];
  });
}

export async function listedAdverts() {
  const adverts = await prisma.post.findMany({
    where: { listedAt: { not: null }, status: "DRAFT", channelId: null },
    orderBy: { listedAt: "desc" },
    include: { interests: true },
  });
  return Promise.all(adverts.map(async (a) => ({ ...a, platforms: await advertPlatforms(a.targetPlatforms) })));
}

// Link to a published post, where the platform's ID is one; otherwise the handle's profile.
export function postUrl(platform: Platform, externalPostId: string | null, handle: string | null) {
  if (externalPostId) {
    if (platform === "FACEBOOK") return `https://www.facebook.com/${externalPostId}`;
    if (platform === "X") return `https://x.com/i/web/status/${externalPostId}`;
  }
  return profileUrl(platform, handle);
}

// Posts the advert on its targeted social platforms (not WhatsApp, which goes to subscribers'
// own numbers after approval). Every post still goes through the platform checks in the worker.
export async function postAdvertToPlatforms(advertId: string) {
  const advert = await prisma.post.findUniqueOrThrow({ where: { id: advertId } });
  const platforms = advert.targetPlatforms.filter((p) => p !== "WHATSAPP");
  const posted: Platform[] = [];
  const skipped: string[] = [];
  for (const platform of platforms) {
    const channel = await prisma.channel.findUnique({ where: { platform } });
    const accounts = (await prisma.socialAccount.findMany({ where: { platform } })).filter((a) =>
      handleMatches(platform, channel?.handle, a),
    );
    if (!channel || accounts.length === 0) {
      skipped.push(`${platform}: no connected account matching the container's handle`);
      continue;
    }
    const post = await prisma.post.create({
      data: {
        content: advert.content,
        mediaUrls: advert.mediaUrls,
        status: "SCHEDULED",
        scheduledAt: new Date(),
        authorId: advert.authorId,
        sourceAdvertId: advert.id,
        targets: { create: accounts.map((a) => ({ accountId: a.id, format: channel.format })) },
      },
    });
    await schedulePost(post.id);
    posted.push(platform);
  }
  return { posted, skipped };
}

// Listing makes it visible to users, optionally posts it now, and proposes the WhatsApp send.
export async function listAdvert(advertId: string, postNow: boolean) {
  await prisma.post.update({ where: { id: advertId }, data: { listedAt: new Date() } });
  const result = postNow ? await postAdvertToPlatforms(advertId) : { posted: [], skipped: [] };
  await proposeCampaign(advertId, "Advert listed").catch(() => null);
  return result;
}
