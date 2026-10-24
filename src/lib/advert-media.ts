import type { Platform } from "@prisma/client";

// Which image an advert uses on each platform. Safe for client components.
export type PlatformMedia = Partial<Record<Platform, string>>;

export const platformMediaOf = (value: unknown): PlatformMedia =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as PlatformMedia) : {};

// The platform's own image, else the advert's main one.
export const mediaFor = (advert: { mediaUrls: string[]; platformMedia?: unknown }, platform: Platform): string | null =>
  platformMediaOf(advert.platformMedia)[platform] ?? advert.mediaUrls[0] ?? null;

// The main image (home page and users' dashboards): a square one when there is one.
export function mainMedia(media: PlatformMedia, order: Platform[]): string | null {
  for (const p of ["INSTAGRAM", "FACEBOOK", "WHATSAPP", ...order] as Platform[]) if (media[p]) return media[p]!;
  return null;
}
