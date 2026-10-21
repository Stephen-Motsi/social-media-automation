import { prisma } from "@/lib/db";

export type ImageInfo = { mimeType: string; width: number; height: number };
export type LoadedImage = ImageInfo & { data: Uint8Array; sizeBytes: number };

// Reads format and dimensions from the file header (PNG, JPEG, GIF, WebP) without extra dependencies.
export function imageInfo(buf: Uint8Array): ImageInfo | null {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length < 30) return null;

  if (b.readUInt32BE(0) === 0x89504e47) {
    return { mimeType: "image/png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.toString("ascii", 0, 4) === "GIF8") {
    return { mimeType: "image/gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const chunk = b.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { mimeType: "image/webp", width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { mimeType: "image/webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { mimeType: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      // Start-of-frame markers carry the dimensions (excluding DHT/JPG/DAC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mimeType: "image/jpeg", height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) i += 2;
      else i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

export function publicMediaUrl(id: string) {
  const base = process.env.PUBLIC_BASE_URL ?? process.env.AUTH_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/media/${id}`;
}

const MAX_REMOTE_BYTES = 25 * 1024 * 1024;

// Loads an image referenced by a post: our own /api/media/<id> from the DB, anything else over HTTP.
export async function loadImage(url: string): Promise<LoadedImage> {
  const own = url.match(/\/api\/media\/([a-z0-9]+)$/i);
  if (own) {
    const asset = await prisma.mediaAsset.findUnique({ where: { id: own[1] } });
    if (!asset) throw new Error("Image not found");
    return { mimeType: asset.mimeType, width: asset.width, height: asset.height, data: asset.data, sizeBytes: asset.sizeBytes };
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download image (${res.status})`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength > MAX_REMOTE_BYTES) throw new Error("Image is larger than 25 MB");
  const info = imageInfo(data);
  if (!info) throw new Error("Unrecognised image format");
  return { ...info, data, sizeBytes: data.byteLength };
}
