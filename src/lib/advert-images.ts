import type { Platform, PostFormat } from "@prisma/client";
import { prisma } from "@/lib/db";
import { editImage, generateImage, imageModel, OpenAIError, type ImageShape } from "@/lib/ai/openai";
import { imageInfo } from "@/lib/media";
import { blockedEverywhere, reviewContent, reviewPrompt } from "@/lib/policy/review";
import type { Issue, PlatformVerdict } from "@/lib/policy/rules";
import { platformShape } from "@/lib/advert-prompt";

// Images for one platform's advert: generated from a prompt, refined with an instruction, or uploaded.
// Every result is checked against that platform's rules for its format (post or story).

export type AdvertImage = { id: string; url: string; width: number; height: number; blocked: boolean };
export type ImageResult = { ok: true; media: AdvertImage; verdict: PlatformVerdict } | { ok: false; error: string; issues?: Issue[] };

const dailyLimit = () => Number(process.env.IMAGE_DAILY_LIMIT ?? 20);
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// The shape each platform shows best: stories and TikTok are tall, X's timeline is wide, the rest square.
export const shapeForChannel = (platform: Platform, format: PostFormat): ImageShape => platformShape(platform, format);

function openAiError(err: unknown): string {
  if (err instanceof OpenAIError) {
    if (err.code === "not_configured") return "Image generation isn't set up yet. Add OPENAI_API_KEY to the .env file.";
    if (err.status === 401) return "OpenAI rejected the API key. Check OPENAI_API_KEY in the .env file.";
    if (/does not exist|model_not_found/i.test(`${err.message} ${err.code}`)) {
      return `The image model "${imageModel()}" isn't available on this OpenAI account. Set OPENAI_IMAGE_MODEL in .env (e.g. gpt-image-2).`;
    }
    if (err.code === "moderation_blocked") return "The image service declined this under its safety rules. Try rewording it.";
  }
  return `Image generation failed: ${err instanceof Error ? err.message : String(err)}`;
}

async function underDailyLimit(userId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const used = await prisma.mediaAsset.count({ where: { createdById: userId, source: "GENERATED", createdAt: { gte: since } } });
  return used < dailyLimit();
}

async function screen(text: string): Promise<{ ok: false; error: string; issues?: Issue[] } | null> {
  try {
    const issues = await reviewPrompt(text);
    return issues.length ? { ok: false, error: "This can't be used on Facebook, Instagram, WhatsApp, X or TikTok.", issues } : null;
  } catch (err) {
    return { ok: false, error: `Couldn't check the description: ${err instanceof Error ? err.message : err}` };
  }
}

// Stores the image after checking it against this platform's rules (and content rules everywhere).
async function store(
  bytes: Uint8Array,
  meta: { userId: string; source: "GENERATED" | "UPLOADED"; prompt: string | null; caption?: string },
  platform: Platform,
  format: PostFormat,
): Promise<ImageResult> {
  const info = imageInfo(bytes);
  if (!info) return { ok: false, error: "That file isn't a JPEG, PNG, WebP or GIF image." };
  const image = { ...info, data: bytes, sizeBytes: bytes.byteLength };
  const { verdicts, moderation } = await reviewContent({ caption: meta.caption ?? "", image, prompt: meta.prompt ?? undefined }, [platform], { [platform]: format });
  const asset = await prisma.mediaAsset.create({
    data: {
      source: meta.source,
      ...info,
      sizeBytes: bytes.byteLength,
      data: bytes,
      prompt: meta.prompt,
      moderation: moderation ?? undefined,
      blocked: moderation ? blockedEverywhere(moderation) : true,
      createdById: meta.userId,
    },
  });
  return {
    ok: true,
    media: { id: asset.id, url: `/api/media/${asset.id}`, width: info.width, height: info.height, blocked: asset.blocked },
    verdict: verdicts[0],
  };
}

export async function generateAdvertImage(userId: string, prompt: string, platform: Platform, format: PostFormat, caption = ""): Promise<ImageResult> {
  const text = prompt.trim();
  if (text.length < 3) return { ok: false, error: "Describe the advert image in a few words." };
  if (text.length > 1000) return { ok: false, error: "Keep the description under 1,000 characters." };
  if (!process.env.OPENAI_API_KEY) return { ok: false, error: openAiError(new OpenAIError("", "not_configured")) };
  if (!(await underDailyLimit(userId))) return { ok: false, error: `You've reached today's limit of ${dailyLimit()} images. Try again tomorrow.` };
  const blocked = await screen(text);
  if (blocked) return blocked;
  try {
    const bytes = await generateImage(text, shapeForChannel(platform, format));
    return store(new Uint8Array(bytes), { userId, source: "GENERATED", prompt: text, caption }, platform, format);
  } catch (err) {
    return { ok: false, error: openAiError(err) };
  }
}

export async function refineAdvertImage(
  userId: string,
  mediaId: string,
  instruction: string,
  platform: Platform,
  format: PostFormat,
  caption = "",
): Promise<ImageResult> {
  const text = instruction.trim();
  if (text.length < 3) return { ok: false, error: "Describe what to change, e.g. \"make the background brighter\"." };
  if (!process.env.OPENAI_API_KEY) return { ok: false, error: openAiError(new OpenAIError("", "not_configured")) };
  const source = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
  if (!source || source.blocked) return { ok: false, error: "Create or upload a photo first." };
  if (!(await underDailyLimit(userId))) return { ok: false, error: `You've reached today's limit of ${dailyLimit()} images. Try again tomorrow.` };
  const blocked = await screen(text);
  if (blocked) return blocked;
  try {
    const bytes = await editImage(
      { data: source.data, mimeType: source.mimeType },
      `${text}. Keep it a realistic advertising photo. Do not add any words, letters, prices, logos or watermarks.`,
      shapeForChannel(platform, format),
    );
    const prompt = [source.prompt, `Refined: ${text}`].filter(Boolean).join(" | ").slice(0, 2000);
    return store(new Uint8Array(bytes), { userId, source: "GENERATED", prompt, caption }, platform, format);
  } catch (err) {
    return { ok: false, error: openAiError(err) };
  }
}

export async function uploadAdvertImage(userId: string, bytes: Uint8Array, platform: Platform, format: PostFormat, caption = ""): Promise<ImageResult> {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, error: "Photos can be up to 20 MB." };
  return store(bytes, { userId, source: "UPLOADED", prompt: null, caption }, platform, format);
}
