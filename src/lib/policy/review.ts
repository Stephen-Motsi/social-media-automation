import type { Platform } from "@prisma/client";
import { moderate, type ModerationResult } from "@/lib/ai/openai";
import {
  BORDERLINE_SCORE,
  moderationPolicy,
  platformOrder,
  platformRules,
  restrictedTopics,
  restrictedTopicSeverity,
  type Issue,
  type PlatformVerdict,
} from "./rules";

export type ReviewImage = { mimeType: string; width: number; height: number; sizeBytes: number; data: Uint8Array };
export type ReviewInput = { caption: string; image?: ReviewImage | null };

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const prettyFormat = (mime: string) => mime.replace("image/", "").toUpperCase();

function ratioLabel(w: number, h: number) {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const d = gcd(w, h);
  return `${w / d}:${h / d}`;
}

export function technicalIssues(platform: Platform, { caption, image }: ReviewInput): Issue[] {
  const rules = platformRules[platform];
  const issues: Issue[] = [];
  const text = caption.trim();

  if (rules.image.required && !image) {
    issues.push({ code: "image.required", severity: "block", message: `${rules.name} posts need an image.` });
  }
  if (rules.text.required && !text) {
    issues.push({ code: "text.required", severity: "block", message: `${rules.name} messages need text.` });
  }
  if (!text && !image) {
    issues.push({ code: "post.empty", severity: "block", message: "Add a caption or an image." });
  }

  if (image) {
    if (!rules.image.formats.includes(image.mimeType)) {
      issues.push({
        code: "image.format",
        severity: "block",
        message: `${rules.name} accepts ${rules.image.formats.map(prettyFormat).join(", ")} images; this one is ${prettyFormat(image.mimeType)}.`,
      });
    }
    if (image.sizeBytes > rules.image.maxBytes) {
      issues.push({
        code: "image.size",
        severity: "block",
        message: `${rules.name} images must be under ${mb(rules.image.maxBytes)}; this one is ${mb(image.sizeBytes)}.`,
      });
    }
    const aspect = image.width / image.height;
    const { minAspect, maxAspect } = rules.image;
    if ((minAspect && aspect < minAspect - 0.005) || (maxAspect && aspect > maxAspect + 0.005)) {
      issues.push({
        code: "image.aspect",
        severity: "block",
        message: `${rules.name} needs a shape between 4:5 (portrait) and 1.91:1 (landscape); this image is ${ratioLabel(image.width, image.height)}.`,
      });
    }
    if (image.width < rules.image.minWidth) {
      issues.push({
        code: "image.small",
        severity: "warn",
        message: `${rules.name} may upscale images narrower than ${rules.image.minWidth}px, which looks blurry.`,
      });
    }
    if (platform === "WHATSAPP") {
      issues.push({
        code: "image.whatsapp_text_only",
        severity: "warn",
        message: "WhatsApp messages are sent as text for now, so the image won't be included.",
      });
    }
  }

  if (text.length > rules.text.maxLength) {
    issues.push({
      code: "text.length",
      severity: "block",
      message: `${rules.name} allows ${rules.text.maxLength.toLocaleString()} characters; this has ${text.length.toLocaleString()}.`,
    });
  }
  const hashtags = text.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;
  if (rules.text.maxHashtags && hashtags > rules.text.maxHashtags) {
    issues.push({
      code: "text.hashtags",
      severity: "block",
      message: `${rules.name} allows up to ${rules.text.maxHashtags} hashtags; this has ${hashtags}.`,
    });
  }
  const mentions = text.match(/(^|\s)@[\w.]+/g)?.length ?? 0;
  if (rules.text.maxMentions && mentions > rules.text.maxMentions) {
    issues.push({
      code: "text.mentions",
      severity: "block",
      message: `${rules.name} allows up to ${rules.text.maxMentions} @mentions; this has ${mentions}.`,
    });
  }
  return issues;
}

const categoryLabels: Record<string, string> = {
  sexual: "sexual content",
  "sexual/minors": "sexual content involving minors",
  hate: "hate speech",
  "hate/threatening": "threatening hate speech",
  harassment: "harassment",
  "harassment/threatening": "threats",
  violence: "violence",
  "violence/graphic": "graphic violence",
  illicit: "illegal activity",
  "illicit/violent": "weapons or violent crime",
  "self-harm": "self-harm",
  "self-harm/intent": "self-harm",
  "self-harm/instructions": "self-harm",
};
const categoryLabel = (cat: string) => categoryLabels[cat] ?? cat.replace(/[/-]/g, " ");

export function moderationIssues(platform: Platform, result: ModerationResult): Issue[] {
  const policy = moderationPolicy[platform];
  const name = platformRules[platform].name;
  const issues: Issue[] = [];

  for (const [category, severity] of Object.entries(policy)) {
    const flagged = result.categories[category];
    const score = result.category_scores[category] ?? 0;
    if (flagged) {
      issues.push({
        code: `moderation.${category}`,
        severity,
        message:
          severity === "block"
            ? `Breaks ${name}'s rules on ${categoryLabel(category)}.`
            : `May conflict with ${name}'s rules on ${categoryLabel(category)}. Review before posting.`,
      });
    } else if (severity === "block" && score >= BORDERLINE_SCORE) {
      issues.push({
        code: `moderation.${category}.borderline`,
        severity: "warn",
        message: `Close to ${name}'s limit on ${categoryLabel(category)}. Review before posting.`,
      });
    }
  }
  return issues;
}

export function topicIssues(platform: Platform, caption: string, prompt?: string): Issue[] {
  const severity = restrictedTopicSeverity[platform];
  const name = platformRules[platform].name;
  const haystack = `${caption}\n${prompt ?? ""}`;
  return restrictedTopics
    .filter((t) => t.pattern.test(haystack))
    .map((t) => ({
      code: `topic.${t.code}`,
      severity,
      message:
        severity === "block"
          ? `${name} doesn't allow promoting ${t.label}.`
          : `${name} restricts promotion of ${t.label}. Organic posts may be limited by age or region.`,
    }));
}

function verdict(platform: Platform, issues: Issue[]): PlatformVerdict {
  const status = issues.some((i) => i.severity === "block")
    ? "block"
    : issues.some((i) => i.severity === "warn")
      ? "warn"
      : "pass";
  return { platform, status, issues };
}

// Pure review from an already-computed moderation result (or null when it couldn't run).
export function review(
  input: ReviewInput & { prompt?: string },
  moderation: ModerationResult | null,
  platforms: Platform[] = platformOrder,
  moderationError?: string,
): PlatformVerdict[] {
  return platforms.map((platform) => {
    const issues = [...technicalIssues(platform, input), ...topicIssues(platform, input.caption, input.prompt)];
    if (moderation) {
      issues.push(...moderationIssues(platform, moderation));
    } else {
      // Fail closed: if we can't check content, we don't publish it.
      issues.push({
        code: "moderation.unavailable",
        severity: "block",
        message: `Content check couldn't run${moderationError ? ` (${moderationError})` : ""}. Try again shortly.`,
      });
    }
    return verdict(platform, issues);
  });
}

// Full review: runs moderation on caption + image together, then applies every platform's rules.
export async function reviewContent(
  input: ReviewInput & { prompt?: string },
  platforms: Platform[] = platformOrder,
): Promise<{ verdicts: PlatformVerdict[]; moderation: ModerationResult | null }> {
  let moderation: ModerationResult | null = null;
  let error: string | undefined;
  try {
    moderation = await moderate({
      text: input.caption,
      image: input.image ? { mimeType: input.image.mimeType, data: input.image.data } : undefined,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  return { verdicts: review(input, moderation, platforms, error), moderation };
}

// Screens an image prompt before spending money on generation.
// Uses the strictest rule across platforms: if any platform would block it, we don't generate it.
export async function reviewPrompt(prompt: string): Promise<Issue[]> {
  const result = await moderate({ text: prompt });
  const issues = new Map<string, Issue>();
  for (const platform of platformOrder) {
    for (const issue of moderationIssues(platform, result)) {
      if (issue.severity !== "block") continue;
      issues.set(issue.code, {
        ...issue,
        message: `This prompt asks for content that breaks the rules on ${categoryLabel(issue.code.replace("moderation.", ""))}.`,
      });
    }
  }
  return [...issues.values()];
}

// True when the image alone breaks content rules on every platform.
export function blockedEverywhere(moderation: ModerationResult) {
  return platformOrder.every((p) =>
    moderationIssues(p, moderation).some((i) => i.severity === "block"),
  );
}
