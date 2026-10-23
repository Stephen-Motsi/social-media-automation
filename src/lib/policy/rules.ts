import type { Platform, PostFormat } from "@prisma/client";

// Per-platform publishing rules. Sources (re-check when Meta updates them):
// - Instagram content publishing: https://developers.facebook.com/docs/instagram-platform/content-publishing
// - Facebook Pages photos:        https://developers.facebook.com/docs/graph-api/reference/page/photos
// - WhatsApp Cloud API media:     https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
// - Meta Community Standards:     https://transparency.meta.com/policies/community-standards
// - WhatsApp Business & Commerce: https://business.whatsapp.com/policy
// - Instagram stories:            https://developers.facebook.com/docs/instagram-platform/content-publishing#stories
// - Facebook Page stories:        https://developers.facebook.com/docs/page-stories-api
// - X posts & media:              https://docs.x.com/x-api/posts/manage-tweets/introduction
// - X rules:                      https://help.x.com/en/rules-and-policies/x-rules
// - TikTok Content Posting API:   https://developers.tiktok.com/doc/content-posting-api-reference-photo-post
// - TikTok Community Guidelines:  https://www.tiktok.com/community-guidelines
// These are a product-level starting point, not legal advice; have them reviewed before launch.

export type Severity = "block" | "warn";
export type Issue = { code: string; severity: Severity; message: string };
export type PlatformVerdict = {
  platform: Platform;
  format: PostFormat;
  status: "pass" | "warn" | "block";
  issues: Issue[];
};

export const platformOrder: Platform[] = ["FACEBOOK", "INSTAGRAM", "WHATSAPP", "X", "TIKTOK"];

// What each platform's API can publish. Unsupported formats are shown but disabled in the UI.
export const formatSupport: Record<Platform, Record<PostFormat, { label: string; supported: boolean; reason?: string }>> = {
  FACEBOOK: { POST: { label: "Post", supported: true }, STORY: { label: "Story", supported: true } },
  INSTAGRAM: { POST: { label: "Post", supported: true }, STORY: { label: "Story", supported: true } },
  WHATSAPP: {
    POST: { label: "Message", supported: true },
    STORY: {
      label: "Status",
      supported: false,
      reason: "WhatsApp's Business API can't post Status updates. It can only send messages.",
    },
  },
  X: {
    POST: { label: "Post", supported: true },
    STORY: { label: "Story", supported: false, reason: "X doesn't have stories." },
  },
  TIKTOK: {
    POST: { label: "Post", supported: true },
    STORY: { label: "Story", supported: false, reason: "TikTok's API doesn't support posting stories." },
  },
};

const MB = 1024 * 1024;

export type PlatformRules = {
  name: string;
  image: {
    required: boolean;
    formats: string[];
    maxBytes: number;
    minWidth: number;
    // width / height
    minAspect?: number;
    maxAspect?: number;
  };
  text: { required: boolean; maxLength: number; maxHashtags?: number; maxMentions?: number };
};

export const platformRules: Record<Platform, PlatformRules> = {
  INSTAGRAM: {
    name: "Instagram",
    image: { required: true, formats: ["image/jpeg"], maxBytes: 8 * MB, minWidth: 320, minAspect: 4 / 5, maxAspect: 1.91 },
    text: { required: false, maxLength: 2200, maxHashtags: 30, maxMentions: 20 },
  },
  FACEBOOK: {
    name: "Facebook",
    image: { required: false, formats: ["image/jpeg", "image/png", "image/gif", "image/webp"], maxBytes: 4 * MB, minWidth: 200 },
    text: { required: false, maxLength: 63206 },
  },
  WHATSAPP: {
    name: "WhatsApp",
    image: { required: false, formats: ["image/jpeg", "image/png"], maxBytes: 5 * MB, minWidth: 1 },
    // Messages are currently sent as text (see src/lib/meta/whatsapp.ts)
    text: { required: true, maxLength: 4096 },
  },
  X: {
    name: "X",
    image: { required: false, formats: ["image/jpeg", "image/png", "image/gif", "image/webp"], maxBytes: 5 * MB, minWidth: 1 },
    // Weighted length: links count as 23, emoji and CJK characters as 2 (see xWeightedLength)
    text: { required: false, maxLength: 280 },
  },
  TIKTOK: {
    name: "TikTok",
    // Photo posts only: our images aren't video. PNG isn't accepted.
    image: { required: true, formats: ["image/jpeg", "image/webp"], maxBytes: 20 * MB, minWidth: 360 },
    text: { required: false, maxLength: 4000 },
  },
};

// Story rules for platforms that support stories (images only; captions aren't shown).
export const storyRules: Partial<Record<Platform, { formats: string[]; maxBytes: number }>> = {
  INSTAGRAM: { formats: ["image/jpeg"], maxBytes: 8 * MB },
  FACEBOOK: { formats: ["image/jpeg", "image/png"], maxBytes: 4 * MB },
};
// Stories are shown full screen at 9:16; other shapes get cropped or letterboxed.
export const STORY_ASPECT = { min: 0.5, max: 0.6 };

// How each platform treats an OpenAI moderation category when it is flagged.
// Categories: https://platform.openai.com/docs/guides/moderation
const metaBaseline: Record<string, Severity> = {
  "sexual/minors": "block",
  sexual: "block", // Meta: Adult Nudity & Sexual Activity
  hate: "block",
  "hate/threatening": "block",
  "harassment/threatening": "block",
  "violence/graphic": "block",
  "illicit/violent": "block",
  "self-harm/intent": "block",
  "self-harm/instructions": "block",
  harassment: "warn",
  violence: "warn",
  "self-harm": "warn",
  illicit: "warn",
};

export const moderationPolicy: Record<Platform, Record<string, Severity>> = {
  FACEBOOK: metaBaseline,
  INSTAGRAM: metaBaseline,
  // WhatsApp Business/Commerce policy prohibits illegal products and services outright
  WHATSAPP: { ...metaBaseline, illicit: "block" },
  // X allows labelled adult content, but adverts from this tool never should contain it
  X: metaBaseline,
  // TikTok Community Guidelines prohibit promoting illegal activity
  TIKTOK: { ...metaBaseline, illicit: "block" },
};

// A blocking category scoring at or above this, without being flagged, is surfaced as a warning.
export const BORDERLINE_SCORE = 0.25;

// Regulated goods and claims (Meta Commerce Policy / Branded Content / Community Standards).
// Facebook, Instagram and X allow some organic posts about these with limits, so they warn;
// WhatsApp's Commerce Policy and TikTok's Community Guidelines prohibit them, so they block.
export const restrictedTopics: { code: string; label: string; pattern: RegExp }[] = [
  { code: "alcohol", label: "alcohol", pattern: /\b(alcohol|beers?|wines?|whisk(e)?y|vodka|gin|liquor|tequila|rum)\b/i },
  { code: "tobacco", label: "tobacco or vaping", pattern: /\b(cigarettes?|cigars?|tobacco|vap(e|es|ing)|e-?cig\w*|shisha|hookah|nicotine)\b/i },
  { code: "weapons", label: "weapons", pattern: /\b(guns?|firearms?|ammo|ammunition|rifles?|pistols?|explosives?)\b/i },
  { code: "drugs", label: "drugs", pattern: /\b(cannabis|marijuana|weed|cbd|thc|cocaine|heroin|meth|mdma|ecstasy|kratom)\b/i },
  { code: "gambling", label: "gambling or betting", pattern: /\b(betting|bet\s+now|casino|jackpot|sportsbook|gambl\w*|lotter(y|ies)|odds\s+boost)\b/i },
  { code: "pharma", label: "prescription drugs or diet pills", pattern: /\b(prescription|viagra|opioids?|antibiotics?|diet\s+pills?|weight[-\s]loss\s+pills?)\b/i },
  { code: "adult", label: "adult products or services", pattern: /\b(sex\s+toys?|adult\s+toys?|escorts?|xxx|onlyfans)\b/i },
  { code: "finance", label: "risky financial claims", pattern: /\b(guaranteed\s+(returns?|profits?|income)|double\s+your\s+money|forex\s+signals?|crypto\s+(giveaway|airdrop))\b/i },
];

export const restrictedTopicSeverity: Record<Platform, Severity> = {
  FACEBOOK: "warn",
  INSTAGRAM: "warn",
  WHATSAPP: "block",
  X: "warn",
  // TikTok prohibits promoting drugs, weapons, gambling, tobacco and similar regulated goods
  TIKTOK: "block",
};
