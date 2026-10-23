import type { Platform, PostFormat } from "@prisma/client";
import type { ImageShape } from "@/lib/ai/openai";

// Builds the image prompt for "Create photo" from what the admin specified about the advert.
// Safe for client components (no server imports).

export function advertImagePrompt(input: { title: string; about: string; caption: string; topics: string[] }) {
  const subject =
    [input.title, input.about].map((s) => s.trim().replace(/[.!?\s]+$/, "")).filter(Boolean).join(". ") || input.caption.trim().replace(/[.!?\s]+$/, "");
  if (!subject) return "";
  return [
    `Professional advertising photo for: ${subject.replace(/\s+/g, " ")}.`,
    input.topics.length ? `Category: ${input.topics.join(", ")}.` : "",
    "Bright, eye-catching, realistic photography with natural light and a clean, uncluttered background; a Kenyan setting where it fits.",
    "The main subject is centred with space around it.",
    // AI images often misspell text; the caption carries the words.
    "Do not include any words, letters, numbers, prices, logos or watermarks in the image.",
  ]
    .filter(Boolean)
    .join(" ");
}

// Square works on every platform. Portrait only when every target is a story.
export function shapeFor(targets: { platform: Platform; format: PostFormat }[]): ImageShape {
  return targets.length > 0 && targets.every((t) => t.format === "STORY") ? "portrait" : "square";
}
