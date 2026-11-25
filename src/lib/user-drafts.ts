import { z } from "zod";
import type { Platform } from "@prisma/client";
import { prisma } from "@/lib/db";
import { mainMedia, type PlatformMedia } from "@/lib/advert-media";
import { publicMediaUrl } from "@/lib/media";
import { platformOrder } from "@/lib/policy/rules";
import { reviewContent } from "@/lib/policy/review";

const platformSchema = z.enum(["FACEBOOK", "INSTAGRAM", "WHATSAPP", "X", "TIKTOK"]);
const draftSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().max(120),
  about: z.string().max(500),
  caption: z.string().max(63206),
  platforms: z.array(platformSchema).max(5),
  media: z.array(z.object({ platform: platformSchema, id: z.string().min(1) })).max(5),
});

export type UserDraftInput = z.infer<typeof draftSchema>;

export async function saveUserDraft(userId: string, value: UserDraftInput) {
  const parsed = draftSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid draft details.");
  const input = parsed.data;
  if (!input.title.trim() && !input.caption.trim() && !input.about.trim() && input.media.length === 0) {
    throw new Error("Add a title, description, caption or image first.");
  }
  const platforms = platformOrder.filter((platform) => input.platforms.includes(platform));
  if (platforms.length !== input.platforms.length || new Set(input.media.map((item) => item.platform)).size !== input.media.length
    || input.media.some((item) => !platforms.includes(item.platform))) {
    throw new Error("Choose valid platforms and images.");
  }
  if (input.id && !(await prisma.post.findFirst({
    where: { id: input.id, authorId: userId, status: "DRAFT", channelId: null, sourceAdvertId: null, listedAt: null },
    select: { id: true },
  }))) throw new Error("Draft not found or no longer editable.");

  const mediaIds = [...new Set(input.media.map((item) => item.id))];
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: mediaIds }, createdById: userId, blocked: false },
  });
  if (assets.length !== mediaIds.length) throw new Error("An image is unavailable or does not belong to you.");

  const media: PlatformMedia = {};
  const mediaById: PlatformMedia = {};
  for (const item of input.media) {
    media[item.platform] = publicMediaUrl(item.id);
    mediaById[item.platform] = item.id;
  }
  const main = mainMedia(media, platforms);
  const mainId = mainMedia(mediaById, platforms);
  const verdicts = await Promise.all(platforms.map(async (platform) => {
    const selectedId = mediaById[platform] ?? mainId;
    const asset = selectedId ? assets.find((item) => item.id === selectedId) : null;
    const result = await reviewContent({ caption: input.caption, image: asset, prompt: asset?.prompt ?? undefined }, [platform]);
    return result.verdicts[0];
  }));
  const data = {
    title: input.title.trim() || null,
    about: input.about.trim() || null,
    content: input.caption.trim(),
    targetPlatforms: platforms,
    mediaUrls: main ? [main] : [],
    platformMedia: media,
    checks: verdicts,
    reviewStatus: "PENDING_REVIEW" as const,
    reviewedAt: null,
    reviewedById: null,
    reviewReason: null,
  };
  if (input.id) {
    const updated = await prisma.post.updateMany({
      where: { id: input.id, authorId: userId, status: "DRAFT", channelId: null, sourceAdvertId: null, listedAt: null },
      data,
    });
    if (!updated.count) throw new Error("Draft not found or no longer editable.");
    return { postId: input.id, verdicts };
  }
  const post = await prisma.post.create({
    data: { ...data, status: "DRAFT", authorId: userId, targetLocations: [] },
    select: { id: true },
  });
  return { postId: post.id, verdicts };
}

export async function loadUserDraft(userId: string, id: string) {
  const draft = await prisma.post.findFirst({
    where: { id, authorId: userId, status: "DRAFT", channelId: null, sourceAdvertId: null, listedAt: null },
    select: { id: true, title: true, about: true, content: true, targetPlatforms: true, mediaUrls: true, platformMedia: true },
  });
  if (!draft) return null;
  const raw = draft.platformMedia;
  if (raw !== null && (typeof raw !== "object" || Array.isArray(raw))) throw new Error("This draft has unsupported media and cannot be edited here.");
  const entries = Object.entries(raw ?? {});
  if (draft.mediaUrls.length > 1 || entries.some(([platform, url]) =>
    !draft.targetPlatforms.includes(platform as Platform) || typeof url !== "string"
  ) || (draft.targetPlatforms.length === 0 && draft.mediaUrls.length > 0)) {
    throw new Error("This draft has unsupported media and cannot be edited here.");
  }
  const urls = [draft.mediaUrls[0], ...entries.map(([, url]) => url)].filter((url): url is string => typeof url === "string");
  const idFromUrl = (url: string) => url.match(/\/api\/media\/([a-z0-9]+)$/i)?.[1];
  const ids = urls.map(idFromUrl);
  if (ids.some((mediaId) => !mediaId)) throw new Error("This draft has unsupported media and cannot be edited here.");
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: ids.filter((mediaId): mediaId is string => !!mediaId) }, createdById: userId, blocked: false },
    select: { id: true },
  });
  if (new Set(ids).size !== assets.length) throw new Error("A draft image is unavailable or does not belong to you.");
  const byPlatform = Object.fromEntries(entries);
  const media = draft.targetPlatforms.flatMap((platform) => {
    const url = byPlatform[platform] ?? draft.mediaUrls[0];
    return typeof url === "string" ? [{ platform, id: idFromUrl(url)! }] : [];
  });
  return {
    id: draft.id, title: draft.title ?? "", about: draft.about ?? "", caption: draft.content,
    platforms: draft.targetPlatforms, media,
  };
}
