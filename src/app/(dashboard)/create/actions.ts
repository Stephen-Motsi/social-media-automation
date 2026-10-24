"use server";

import { z } from "zod";
import { requireStaff } from "@/lib/session";
import { prisma } from "@/lib/db";
import { generateImage, imageModel, OpenAIError, IMAGE_SIZES, type ImageShape } from "@/lib/ai/openai";
import { imageInfo, publicMediaUrl } from "@/lib/media";
import { blockedEverywhere, reviewContent, reviewPrompt } from "@/lib/policy/review";
import { normalizeLocation } from "@/lib/audience";
import { revalidatePath } from "next/cache";
import { reasonFor } from "@/lib/errors";
import { platformOrder, type Issue, type PlatformVerdict } from "@/lib/policy/rules";
import type { Formats } from "@/lib/policy/review";
import type { Platform } from "@prisma/client";

export type GeneratedMedia = { id: string; url: string; width: number; height: number; blocked: boolean };
export type ActionResult<T> = ({ ok: true } & T) | { ok: false; error: string; issues?: Issue[] };

const dailyLimit = () => Number(process.env.IMAGE_DAILY_LIMIT ?? 20);

const NOT_CONFIGURED = "Image generation isn't set up yet. Add OPENAI_API_KEY to the .env file.";

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

const generateSchema = z.object({
  prompt: z.string().trim().min(3, "Describe the image in a few words.").max(1000, "Keep the prompt under 1,000 characters."),
  shape: z.enum(Object.keys(IMAGE_SIZES) as [ImageShape, ...ImageShape[]]),
});

export async function generateAction(input: {
  prompt: string;
  shape: ImageShape;
  targetPlatforms?: Platform[];
}): Promise<ActionResult<{ media: GeneratedMedia; verdicts: PlatformVerdict[] }>> {
  const userId = await requireUser();
  if (!process.env.OPENAI_API_KEY) return { ok: false, error: NOT_CONFIGURED };
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { prompt, shape } = parsed.data;

  // 1. Cost guard
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const usedToday = await prisma.mediaAsset.count({
    where: { createdById: userId, source: "GENERATED", createdAt: { gte: since } },
  });
  if (usedToday >= dailyLimit()) {
    return { ok: false, error: `You've reached today's limit of ${dailyLimit()} images. Try again tomorrow.` };
  }

  // 2. Screen the prompt before generating (fails closed if moderation is unavailable)
  try {
    const promptIssues = await reviewPrompt(prompt);
    if (promptIssues.length > 0) {
      return { ok: false, error: "This prompt can't be used on Facebook, Instagram or WhatsApp.", issues: promptIssues };
    }
  } catch (err) {
    return { ok: false, error: `Couldn't check the prompt: ${err instanceof Error ? err.message : err}` };
  }

  // 3. Generate (OpenAI applies its own safety filter as well)
  let bytes: Buffer;
  try {
    bytes = await generateImage(prompt, shape);
  } catch (err) {
    if (err instanceof OpenAIError && err.status === 401) {
      return { ok: false, error: "OpenAI rejected the API key. Check OPENAI_API_KEY in the .env file." };
    }
    if (err instanceof OpenAIError && err.status === 403) {
      return { ok: false, error: "This OpenAI account can't use image generation yet. Verify your organization in the OpenAI dashboard." };
    }
    if (err instanceof OpenAIError && /does not exist|model_not_found/i.test(`${err.message} ${err.code}`)) {
      return { ok: false, error: `The image model "${imageModel()}" isn't available on this OpenAI account. Set OPENAI_IMAGE_MODEL in .env to one it offers (e.g. gpt-image-2).` };
    }
    if (err instanceof OpenAIError && err.code === "moderation_blocked") {
      return { ok: false, error: "The image service declined this prompt under its safety rules. Try rewording it." };
    }
    return { ok: false, error: `Image generation failed: ${err instanceof Error ? err.message : err}` };
  }
  const info = imageInfo(bytes);
  if (!info) return { ok: false, error: "The image service returned a file we couldn't read." };

  // 4. Check the generated image against every platform's rules
  const image = { ...info, data: new Uint8Array(bytes), sizeBytes: bytes.byteLength };
  const { platforms, formats } = await targetsFor(input.targetPlatforms);
  const { verdicts, moderation } = await reviewContent({ caption: "", image, prompt }, platforms, formats);

  const asset = await prisma.mediaAsset.create({
    data: {
      source: "GENERATED",
      ...info,
      sizeBytes: bytes.byteLength,
      data: image.data,
      prompt,
      moderation: moderation ?? undefined,
      blocked: moderation ? blockedEverywhere(moderation) : true,
      createdById: userId,
    },
  });

  return {
    ok: true,
    media: { id: asset.id, url: `/api/media/${asset.id}`, width: info.width, height: info.height, blocked: asset.blocked },
    verdicts,
  };
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
  caption: string;
  targetPlatforms?: Platform[];
}): Promise<ActionResult<{ verdicts: PlatformVerdict[] }>> {
  await requireUser();
  const asset = input.mediaId ? await loadAsset(input.mediaId) : null;
  const { platforms, formats } = await targetsFor(input.targetPlatforms);
  const { verdicts } = await reviewContent(
    { caption: input.caption, image: asset, prompt: asset?.prompt ?? undefined },
    platforms,
    formats,
  );
  return { ok: true, verdicts };
}

// Creates a draft, or updates one when `id` is given. Drafts save even when a check fails;
// publishing (listing) is what requires the checks to pass. Drafts are never sent to anyone.
export async function saveDraftAction(input: {
  id?: string;
  mediaId?: string | null;
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
  if (!input.title?.trim() && !input.caption.trim() && !input.mediaId) return { ok: false, error: "add a title, caption or photo first." };
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
  const { verdicts } = await reviewContent(
    { caption: input.caption, image: asset, prompt: asset?.prompt ?? undefined },
    platforms,
    formats,
  );
  const data = {
    content: input.caption.trim(),
    mediaUrls: asset ? [publicMediaUrl(asset.id)] : [],
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
