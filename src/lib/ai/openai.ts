// OpenAI image generation + moderation.
// Docs: https://platform.openai.com/docs/guides/image-generation
//       https://platform.openai.com/docs/guides/moderation
// Note: GPT image models require a verified OpenAI organization.

export class OpenAIError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number,
  ) {
    super(message);
  }
}

const baseUrl = () => (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");

async function call<T>(path: string, body: unknown): Promise<T> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new OpenAIError("OPENAI_API_KEY is not set", "not_configured");

  const res = await fetch(`${baseUrl()}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new OpenAIError(json?.error?.message ?? `OpenAI request failed (${res.status})`, json?.error?.code, res.status);
  }
  return json as T;
}

// Sizes supported by GPT image models. Portrait (2:3) is too tall for Instagram;
// the policy review flags that rather than us silently cropping.
export const IMAGE_SIZES = {
  square: "1024x1024",
  landscape: "1536x1024",
  portrait: "1024x1536",
} as const;
export type ImageShape = keyof typeof IMAGE_SIZES;

export async function generateImage(prompt: string, shape: ImageShape): Promise<Buffer> {
  const json = await call<{ data: { b64_json: string }[] }>("images/generations", {
    model: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1",
    prompt,
    size: IMAGE_SIZES[shape],
    n: 1,
    quality: process.env.OPENAI_IMAGE_QUALITY ?? "medium",
    // JPEG because Instagram's publishing API only accepts JPEG
    output_format: "jpeg",
    output_compression: 90,
    // OpenAI's own (stricter) safety filter. Do not lower this to "low".
    moderation: "auto",
  });
  return Buffer.from(json.data[0].b64_json, "base64");
}

export type ModerationResult = {
  flagged: boolean;
  categories: Record<string, boolean>;
  category_scores: Record<string, number>;
};

// Moderates text and/or an image in one request with omni-moderation (free to use).
export async function moderate(input: {
  text?: string;
  image?: { mimeType: string; data: Uint8Array };
}): Promise<ModerationResult> {
  const parts: unknown[] = [];
  if (input.text?.trim()) parts.push({ type: "text", text: input.text });
  if (input.image) {
    const b64 = Buffer.from(input.image.data).toString("base64");
    parts.push({ type: "image_url", image_url: { url: `data:${input.image.mimeType};base64,${b64}` } });
  }
  if (parts.length === 0) return { flagged: false, categories: {}, category_scores: {} };

  const json = await call<{ results: ModerationResult[] }>("moderations", {
    model: "omni-moderation-latest",
    input: parts,
  });

  // Merge in case the API returns one result per input part: worst case wins.
  return json.results.reduce<ModerationResult>(
    (acc, r) => {
      acc.flagged ||= r.flagged;
      for (const [cat, hit] of Object.entries(r.categories)) acc.categories[cat] ||= hit;
      for (const [cat, score] of Object.entries(r.category_scores)) {
        acc.category_scores[cat] = Math.max(acc.category_scores[cat] ?? 0, score);
      }
      return acc;
    },
    { flagged: false, categories: {}, category_scores: {} },
  );
}
