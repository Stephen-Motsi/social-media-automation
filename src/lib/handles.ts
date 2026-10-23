import type { GroupKind, Platform } from "@prisma/client";

// Parent containers and the platforms each one holds.
export const groupOrder: GroupKind[] = ["META", "X", "TIKTOK"];
export const groupPlatforms: Record<GroupKind, Platform[]> = {
  META: ["FACEBOOK", "INSTAGRAM", "WHATSAPP"],
  X: ["X"],
  TIKTOK: ["TIKTOK"],
};
export const groupNames: Record<GroupKind, string> = { META: "Meta", X: "X", TIKTOK: "TikTok" };
export const groupOf = (platform: Platform): GroupKind =>
  (Object.keys(groupPlatforms) as GroupKind[]).find((g) => groupPlatforms[g].includes(platform))!;

// What admins enter as the "handle" for each platform.
export const handleLabels: Record<Platform, { label: string; placeholder: string; hint: string }> = {
  FACEBOOK: { label: "Facebook Page", placeholder: "mangomarketke", hint: "Page username or link, e.g. facebook.com/mangomarketke" },
  INSTAGRAM: { label: "Instagram handle", placeholder: "@mangomarket.ke", hint: "Instagram professional account" },
  WHATSAPP: { label: "WhatsApp Business number", placeholder: "+254 700 000 000", hint: "The business number registered with Meta" },
  X: { label: "X handle", placeholder: "@mangomarket", hint: "The account the posts come from" },
  TIKTOK: { label: "TikTok handle", placeholder: "@mangomarket", hint: "The account the posts come from" },
};

// Turns "@Name", "https://www.instagram.com/name/?hl=en", "+254 700-000 000" etc. into a comparable form.
export function normalizeHandle(platform: Platform, input: string | null | undefined): string {
  let v = (input ?? "").trim();
  if (!v) return "";
  if (platform === "WHATSAPP") return v.replace(/\D/g, "");
  v = v.replace(/^https?:\/\//i, "").replace(/^(www\.|m\.|mobile\.)/i, "");
  v = v.replace(/^(facebook\.com|fb\.com|instagram\.com|x\.com|twitter\.com|tiktok\.com)\//i, "");
  v = v.split(/[/?#]/)[0];
  return v.replace(/^@/, "").toLowerCase();
}

export function validateHandle(platform: Platform, input: string): string | null {
  const h = normalizeHandle(platform, input);
  if (!h) return `Enter the ${handleLabels[platform].label.toLowerCase()}.`;
  if (platform === "WHATSAPP" && (h.length < 8 || h.length > 15)) return "Enter the WhatsApp number in international format, e.g. +254 700 000 000.";
  if (platform !== "WHATSAPP" && platform !== "FACEBOOK" && !/^[a-z0-9._]{1,30}$/.test(h)) {
    return `"${input}" doesn't look like a ${handleLabels[platform].label.toLowerCase()}.`;
  }
  return null;
}

// Display form: "@name" for social handles, "+digits" for WhatsApp.
export function displayHandle(platform: Platform, handle: string | null | undefined) {
  if (!handle) return "";
  if (platform === "WHATSAPP") return `+${handle}`;
  if (platform === "FACEBOOK") return handle;
  return `@${handle}`;
}

export function profileUrl(platform: Platform, handle: string | null | undefined, externalId?: string) {
  const h = handle || "";
  switch (platform) {
    case "FACEBOOK":
      return `https://www.facebook.com/${h || externalId}`;
    case "INSTAGRAM":
      return h ? `https://www.instagram.com/${h}/` : null;
    case "WHATSAPP":
      return h ? `https://wa.me/${h}` : null;
    case "X":
      return h ? `https://x.com/${h}` : null;
    case "TIKTOK":
      return h ? `https://www.tiktok.com/@${h}` : null;
  }
}

// Does a connected account match the handle the admin expects? Facebook Pages without a
// username can also match by Page name or Page ID.
export function handleMatches(
  platform: Platform,
  expected: string | null | undefined,
  account: { handle: string | null; displayName: string; externalId: string },
) {
  const want = normalizeHandle(platform, expected);
  if (!want) return true;
  const candidates = [account.handle, account.externalId];
  if (platform === "FACEBOOK") candidates.push(account.displayName);
  return candidates.some((c) => c && normalizeHandle(platform, c) === want);
}
