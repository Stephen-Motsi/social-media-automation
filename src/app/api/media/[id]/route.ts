import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Public on purpose: Meta downloads post images from this URL when publishing.
// Images that break content rules on every platform are never served.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    select: { data: true, mimeType: true, blocked: true },
  });
  if (!asset || asset.blocked) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(Buffer.from(asset.data), {
    headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
