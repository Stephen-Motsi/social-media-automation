import sharp from "sharp";
import type { Platform, PostFormat } from "@prisma/client";

export type AdvertCopy = {
  headline?: string;
  offer?: string;
  supporting?: string;
  cta?: string;
  handle?: string;
};

const dimensions: Record<Platform, Record<PostFormat, { width: number; height: number }>> = {
  FACEBOOK: { POST: { width: 1080, height: 1080 }, STORY: { width: 1080, height: 1920 } },
  INSTAGRAM: { POST: { width: 1080, height: 1080 }, STORY: { width: 1080, height: 1920 } },
  WHATSAPP: { POST: { width: 1080, height: 1080 }, STORY: { width: 1080, height: 1920 } },
  X: { POST: { width: 1536, height: 1024 }, STORY: { width: 1080, height: 1920 } },
  TIKTOK: { POST: { width: 1080, height: 1920 }, STORY: { width: 1080, height: 1920 } },
};

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function clean(value: string | undefined, limit: number) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function wrap(value: string, maxChars: number) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

export async function composeAdvertImage(background: Buffer, platform: Platform, format: PostFormat, copy: AdvertCopy) {
  const { width, height } = dimensions[platform][format];
  const headline = clean(copy.headline, 90);
  const offer = clean(copy.offer, 40);
  const supporting = clean(copy.supporting, 180);
  const cta = clean(copy.cta, 40);
  const handle = clean(copy.handle, 80);

  const headlineLines = wrap(headline, width < 1200 ? 22 : 28);
  const supportingLines = wrap(supporting, width < 1200 ? 34 : 42);
  const headlineSize = Math.max(46, Math.min(78, Math.round(width / 15)));
  const offerSize = Math.max(40, Math.min(64, Math.round(width / 18)));
  const padding = Math.round(width * 0.055);
  const panelWidth = width - padding * 2;
  const panelTop = Math.round(height * 0.07);
  const bottom = Math.round(height - padding * 0.75);

  const headlineSvg = headlineLines.map((line, index) => `<text x="${padding}" y="${panelTop + headlineSize + index * (headlineSize + 10)}" fill="#FFFFFF" font-family="Arial, Helvetica, sans-serif" font-size="${headlineSize}" font-weight="800">${escapeXml(line)}</text>`).join("");
  const supportTop = panelTop + headlineSize * (headlineLines.length || 1) + headlineSize + 28;
  const supportingSvg = supportingLines.map((line, index) => `<text x="${padding}" y="${supportTop + index * 42}" fill="#FFFFFF" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="600">${escapeXml(line)}</text>`).join("");
  const offerSvg = offer ? `<rect x="${padding}" y="${bottom - 190}" width="${Math.min(panelWidth, Math.max(300, offer.length * 31))}" height="82" rx="41" fill="#FFFFFF" fill-opacity="0.96"/><text x="${padding + 28}" y="${bottom - 130}" fill="#15102B" font-family="Arial, Helvetica, sans-serif" font-size="${offerSize}" font-weight="900">${escapeXml(offer)}</text>` : "";
  const ctaY = bottom - 85;
  const ctaWidth = cta ? Math.min(panelWidth, Math.max(260, cta.length * 31)) : 0;
  const ctaSvg = cta ? `<rect x="${padding}" y="${ctaY}" width="${ctaWidth}" height="70" rx="35" fill="#FF4D8D"/><text x="${padding + ctaWidth / 2}" y="${ctaY + 47}" fill="#FFFFFF" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="32" font-weight="800">${escapeXml(cta.toUpperCase())}</text>` : "";
  const handleSvg = handle ? `<rect x="${width - padding - Math.min(420, Math.max(180, handle.length * 21))}" y="${padding}" width="${Math.min(420, Math.max(180, handle.length * 21))}" height="58" rx="29" fill="#15102B" fill-opacity="0.72"/><text x="${width - padding - 18}" y="${padding + 40}" fill="#FFFFFF" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700">${escapeXml(handle.startsWith("@") ? handle : `@${handle}`)}</text>` : "";

  const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height * 0.48}" fill="#15102B" fill-opacity="0.22"/><rect x="0" y="${height * 0.58}" width="${width}" height="${height * 0.42}" fill="#15102B" fill-opacity="0.38"/>${headlineSvg}${supportingSvg}${offerSvg}${ctaSvg}${handleSvg}</svg>`);

  return sharp(background)
    .resize(width, height, { fit: "cover" })
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}
