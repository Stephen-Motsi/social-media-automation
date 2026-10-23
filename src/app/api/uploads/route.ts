import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getViewer, isStaff } from "@/lib/session";
import { MAX_UPLOAD_BYTES, uploadAdvertImage } from "@/lib/advert-images";

// Staff upload a photo for a social container's advert. It's checked against that
// platform's rules (format, size, shape) and the content rules before it can be used.
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer || !isStaff(viewer.role)) return NextResponse.json({ ok: false, error: "Only admins can upload." }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const channelId = String(form?.get("channelId") ?? "");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Choose a photo to upload." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ ok: false, error: "Photos can be up to 20 MB." }, { status: 400 });
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return NextResponse.json({ ok: false, error: "This container no longer exists." }, { status: 404 });

  const result = await uploadAdvertImage(viewer.id, new Uint8Array(await file.arrayBuffer()), channel.platform, channel.format, String(form?.get("caption") ?? ""));
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
