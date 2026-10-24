"use server";

import { requireStaff } from "@/lib/session";
import { prisma } from "@/lib/db";
import { publicMediaUrl } from "@/lib/media";
import { reviewContent } from "@/lib/policy/review";
import { normalizeLocation } from "@/lib/audience";
import { revalidatePath } from "next/cache";
import { reasonFor } from "@/lib/errors";
import { generateAdvertImage, type ImageResult } from "@/lib/advert-images";
import { mainMedia, type PlatformMedia } from "@/lib/advert-media";
import { platformOrder, type Issue, type PlatformVerdict } from "@/lib/policy/rules";
import type { Formats } from "@/lib/policy/review";
import type { Platform } from "@prisma/client";

export type GeneratedMedia = { id: string; url: string; width: number; height: number; blocked: boolean };
export type ActionResult<T> = ({ ok: true } & T) | { ok: false; error: string; issues?: Issue[] };

// Check against the platforms (and post/story formats) of existing channels; all platforms if none yet.
async function reviewTargets(): Promise<{ platforms: Platform[]; formats: Formats }> {
  const channels = await prisma.channel.findMany({ select: { platform: true, format: true } });
  if (channels.length === 0) return { platforms: platformOrder, formats: {} };
  return {
    platforms: platformOrder.filter((p) => channels.some((c) => c.platform === p)),
    formats: Object.fromEntries(channels.map((c) => [c.platform, c.format])),
  };
}

async function requireUser() {
  return (await requireStaff()).id;
}

// Any staff member can use any generated image (all images are staff-made).
async function loadAsset(mediaId: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
  if (!asset) throw new Error("Image not found");
  return asset;
}

// The platforms to check: the ones chosen for this advert, else every channel's platform.
async function targetsFor(targetPlatforms?: Platform[]): Promise<{ platforms: Platform[]; formats: Formats }> {
  const targets = await reviewTargets();
  const chosen = (targetPlatforms ?? []).filter((p) => platformOrder.includes(p));
  return chosen.length ? { platforms: platformOrder.filter((p) => chosen.includes(p)), formats: targets.formats } : targets;
}

export async function checkAction(input: {
  mediaId?: string;
  // Each platform's own image (media IDs); falls back to mediaId
  media?: Partial<Record<Platform, string>>;
  caption: string;
  targetPlatforms?: Platform[];
}): Promise<ActionResult<{ verdicts: PlatformVerdict[] }>> {
  await requireUser();
  const { platforms, formats } = await targetsFor(input.targetPlatforms);
  return { ok: true, verdicts: await reviewPerPlatform(input.caption, input.media ?? {}, input.mediaId ?? null, platforms, formats) };
}

// Checks each platform against its own image (the one made for it), or the shared one.
async function reviewPerPlatform(caption: string, media: Partial<Record<Platform, string>>, fallback: string | null, platforms: Platform[], formats: Formats) {
  const verdicts: PlatformVerdict[] = [];
  for (const platform of platforms) {
    const id = media[platform] ?? fallback;
    const asset = id ? await loadAsset(id) : null;
    const { verdicts: v } = await reviewContent({ caption, image: asset, prompt: asset?.prompt ?? undefined }, [platform], formats);
    verdicts.push(...v);
  }
  return verdicts;
}

// Creates the image for one platform from the advert's details: its shape, its style, its rules.
export async function generatePlatformImageAction(input: { platform: Platform; format: "POST" | "STORY"; prompt: string; caption: string }): Promise<ImageResult> {
  const userId = await requireUser();
  if (!platformOrder.includes(input.platform)) return { ok: false, error: "Unknown platform." };
  try {
    return await generateAdvertImage(userId, input.prompt, input.platform, input.format === "STORY" ? "STORY" : "POST", input.caption);
  } catch (err) {
    return { ok: false, error: reasonFor(err) };
  }
}

// Creates a draft, or updates one when `id` is given. Drafts save even when a check fails;
// publishing (listing) is what requires the checks to pass. Drafts are never sent to anyone.
export async function saveDraftAction(input: {
  id?: string;
  mediaId?: string | null;
  // Each platform's own image (media IDs)
  media?: Partial<Record<Platform, string>>;
  caption: string;
  interestIds?: string[];
  locations?: string[];
  title?: string;
  about?: string;
  targetPlatforms?: Platform[];
}): Promise<ActionResult<{ postId: string; verdicts: PlatformVerdict[] }>> {
  const userId = await requireUser();
  try {
    return await saveDraft(userId, input);
  } catch (err) {
    return { ok: false, error: reasonFor(err) };
  }
}

async function saveDraft(
  userId: string,
  input: Parameters<typeof saveDraftAction>[0],
): Promise<ActionResult<{ postId: string; verdicts: PlatformVerdict[] }>> {
  const media = Object.fromEntries(Object.entries(input.media ?? {}).filter(([p, id]) => id && (input.targetPlatforms ?? []).includes(p as Platform))) as Partial<Record<Platform, string>>;
  if (!input.title?.trim() && !input.caption.trim() && !input.mediaId && !Object.keys(media).length) return { ok: false, error: "add a title, caption or photo first." };
  if (input.id) {
    const existing = await prisma.post.findFirst({ where: { id: input.id, status: "DRAFT", channelId: null } });
    if (!existing) return { ok: false, error: "this draft no longer exists (it may have been deleted)." };
  }
  const asset = input.mediaId ? await loadAsset(input.mediaId) : null;
  const interestIds = input.interestIds?.length
    ? (await prisma.interest.findMany({ where: { id: { in: input.interestIds } }, select: { id: true } })).map((i) => i.id)
    : [];
  const locations = [...new Set((input.locations ?? []).map((l) => normalizeLocation(l)).filter((l): l is string => Boolean(l)))].slice(0, 20);
  const chosen = platformOrder.filter((p) => (input.targetPlatforms ?? []).includes(p));

  // Never trust the client's last check: review again on save and store the result.
  const { platforms, formats } = await targetsFor(chosen);
  const verdicts = await reviewPerPlatform(input.caption, media, asset?.id ?? null, platforms, formats);
  // Blocked images are never used
  const usable = Object.fromEntries(
    (await prisma.mediaAsset.findMany({ where: { id: { in: Object.values(media) as string[] }, blocked: false }, select: { id: true } })).flatMap((a) =>
      Object.entries(media).filter(([, id]) => id === a.id).map(([p]) => [p, publicMediaUrl(a.id)]),
    ),
  ) as PlatformMedia;
  const main = mainMedia(usable, chosen) ?? (asset && !asset.blocked ? publicMediaUrl(asset.id) : null);
  const data = {
    content: input.caption.trim(),
    mediaUrls: main ? [main] : [],
    platformMedia: usable,
    checks: verdicts,
    targetLocations: locations,
    title: input.title?.trim().slice(0, 120) || null,
    about: input.about?.trim().slice(0, 500) || null,
    targetPlatforms: chosen,
  };
  const post = input.id
    ? await prisma.post.update({ where: { id: input.id }, data: { ...data, interests: { set: interestIds.map((id) => ({ id })) } } })
    : await prisma.post.create({
        data: { ...data, status: "DRAFT", authorId: userId, interests: { connect: interestIds.map((id) => ({ id })) } },
      });
  revalidatePath("/admin/adverts");
  revalidatePath("/");
  return { ok: true, postId: post.id, verdicts };
}
