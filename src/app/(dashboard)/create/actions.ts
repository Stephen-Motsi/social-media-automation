"use server";

import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { generateImage, OpenAIError, IMAGE_SIZES, type ImageShape } from "@/lib/ai/openai";
import { imageInfo, publicMediaUrl } from "@/lib/media";
import { blockedEverywhere, reviewContent, reviewPrompt } from "@/lib/policy/review";
import type { Issue, PlatformVerdict } from "@/lib/policy/rules";

export type GeneratedMedia = { id: string; url: string; width: number; height: number; blocked: boolean };
export type ActionResult<T> = ({ ok: true } & T) | { ok: false; error: string; issues?: Issue[] };

const dailyLimit = () => Number(process.env.IMAGE_DAILY_LIMIT ?? 20);

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  return session.user.id;
}

const generateSchema = z.object({
  prompt: z.string().trim().min(3, "Describe the image in a few words.").max(1000, "Keep the prompt under 1,000 characters."),
  shape: z.enum(Object.keys(IMAGE_SIZES) as [ImageShape, ...ImageShape[]]),
});

export async function generateAction(input: {
  prompt: string;
  shape: ImageShape;
}): Promise<ActionResult<{ media: GeneratedMedia; verdicts: PlatformVerdict[] }>> {
  const userId = await requireUser();
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
    if (err instanceof OpenAIError && err.code === "moderation_blocked") {
      return { ok: false, error: "The image service declined this prompt under its safety rules. Try rewording it." };
    }
    return { ok: false, error: `Image generation failed: ${err instanceof Error ? err.message : err}` };
  }
  const info = imageInfo(bytes);
  if (!info) return { ok: false, error: "The image service returned a file we couldn't read." };

  // 4. Check the generated image against every platform's rules
  const image = { ...info, data: new Uint8Array(bytes), sizeBytes: bytes.byteLength };
  const { verdicts, moderation } = await reviewContent({ caption: "", image, prompt });

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

async function loadOwnAsset(userId: string, mediaId: string) {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: mediaId, createdById: userId } });
  if (!asset) throw new Error("Image not found");
  return asset;
}

export async function checkAction(input: {
  mediaId?: string;
  caption: string;
}): Promise<ActionResult<{ verdicts: PlatformVerdict[] }>> {
  const userId = await requireUser();
  const asset = input.mediaId ? await loadOwnAsset(userId, input.mediaId) : null;
  const { verdicts } = await reviewContent({
    caption: input.caption,
    image: asset,
    prompt: asset?.prompt ?? undefined,
  });
  return { ok: true, verdicts };
}

export async function saveDraftAction(input: {
  mediaId?: string;
  caption: string;
}): Promise<ActionResult<{ postId: string; verdicts: PlatformVerdict[] }>> {
  const userId = await requireUser();
  const asset = input.mediaId ? await loadOwnAsset(userId, input.mediaId) : null;

  // Never trust the client's last check: review again on save.
  const { verdicts } = await reviewContent({
    caption: input.caption,
    image: asset,
    prompt: asset?.prompt ?? undefined,
  });
  if (verdicts.every((v) => v.status === "block")) {
    return { ok: false, error: "This post can't go on any platform yet. Fix the issues below and try again." };
  }

  const post = await prisma.post.create({
    data: {
      content: input.caption.trim(),
      mediaUrls: asset ? [publicMediaUrl(asset.id)] : [],
      status: "DRAFT",
      checks: verdicts,
      authorId: userId,
    },
  });
  return { ok: true, postId: post.id, verdicts };
}
