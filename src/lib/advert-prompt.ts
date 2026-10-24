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

// The shape each platform shows best: stories and TikTok are tall, X's timeline is wide, the rest square.
export function platformShape(platform: Platform, format: PostFormat): ImageShape {
  if (format === "STORY" || platform === "TIKTOK") return "portrait";
  if (platform === "X") return "landscape";
  return "square";
}

// How the photo should look on each platform, added to the details.
const platformStyle: Record<Platform, string> = {
  FACEBOOK: "Styled for a Facebook feed: warm, friendly and welcoming, like a local business people trust.",
  INSTAGRAM: "Styled for Instagram: polished lifestyle look, rich colours and careful composition, like a top brand's post.",
  WHATSAPP: "Styled for a WhatsApp chat: one clear subject that reads well as a small picture on a phone, plain background.",
  X: "Styled for the X timeline: a single strong focal point that stands out in a fast-moving feed.",
  TIKTOK: "Styled for TikTok: energetic and youthful, bold colours, the subject large and close up.",
};
const shapeStyle: Record<ImageShape, string> = {
  square: "Square 1:1 composition.",
  landscape: "Wide 3:2 landscape composition.",
  portrait: "Tall vertical composition; keep the subject in the middle, as the top and bottom are covered by the app.",
};

// The prompt for one platform's image: the advert's details plus that platform's style and shape.
export function platformImagePrompt(details: Parameters<typeof advertImagePrompt>[0], platform: Platform, format: PostFormat, base = advertImagePrompt(details)) {
  if (!base.trim()) return "";
  const story = format === "STORY" && platform !== "TIKTOK" ? ` (a ${platform === "INSTAGRAM" ? "Instagram" : "Facebook"} story)` : "";
  return `${base.trim()} ${platformStyle[platform]}${story} ${shapeStyle[platformShape(platform, format)]}`;
}
