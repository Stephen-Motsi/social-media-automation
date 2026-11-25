"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateAdvertImage, refineAdvertImage, type ImageResult } from "@/lib/advert-images";
import { reasonFor } from "@/lib/errors";
import { formatSupport } from "@/lib/policy/rules";
import { requireViewer } from "@/lib/session";
import { saveUserDraft, type UserDraftInput } from "@/lib/user-drafts";

const imageInput = z.object({
  platform: z.enum(["FACEBOOK", "INSTAGRAM", "WHATSAPP", "X", "TIKTOK"]),
  format: z.enum(["POST", "STORY"]),
  prompt: z.string().max(1000),
  caption: z.string().max(63206),
});

const generateInput = imageInput.extend({
  copy: z.object({
    headline: z.string().max(90),
    offer: z.string().max(40),
    supporting: z.string().max(180),
    cta: z.string().max(40),
  }).optional(),
});

export async function generateImageAction(value: z.infer<typeof generateInput>): Promise<ImageResult> {
  const viewer = await requireViewer();
  const parsed = generateInput.safeParse(value);
  if (!parsed.success) return { ok: false, error: "Check the image description and advert details; the image prompt must be at most 1,000 characters." };
  if (!formatSupport[parsed.data.platform][parsed.data.format].supported) return { ok: false, error: "Choose a supported platform and format." };
  const { platform, format, prompt, caption, copy } = parsed.data;
  return generateAdvertImage(viewer.id, prompt, platform, format, caption, copy);
}

export async function refineImageAction(value: z.infer<typeof imageInput> & { mediaId: string }): Promise<ImageResult> {
  const viewer = await requireViewer();
  const parsed = imageInput.extend({ mediaId: z.string().min(1) }).safeParse(value);
  if (!parsed.success || !formatSupport[parsed.data.platform][parsed.data.format].supported) return { ok: false, error: "Choose a supported platform, format and image." };
  const { platform, format, prompt, caption, mediaId } = parsed.data;
  return refineAdvertImage(viewer.id, mediaId, prompt, platform, format, caption, { ownerOnly: true });
}

export async function saveDraftAction(value: UserDraftInput) {
  const viewer = await requireViewer();
  try {
    const result = await saveUserDraft(viewer.id, value);
    revalidatePath("/me");
    revalidatePath("/me/create");
    return { ok: true as const, ...result };
  } catch (error) {
    return { ok: false as const, error: reasonFor(error) };
  }
}
