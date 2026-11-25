import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getViewer } from "@/lib/session";
import { canAccessOwnedRecord } from "@/lib/ownership";

// Platforms must be able to download images while a post is being published.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    select: { data: true, mimeType: true, blocked: true, createdById: true },
  });
  if (!asset || asset.blocked) return new NextResponse("Not found", { status: 404 });

  const suffix = `/api/media/${id}`;
  const [visibility] = await prisma.$queryRaw<{ visible: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM "Post" AS p
      WHERE (
        (p."listedAt" IS NOT NULL AND p."status" = 'DRAFT' AND p."channelId" IS NULL)
        OR p."status" IN ('PUBLISHING', 'PUBLISHED')
        OR EXISTS (SELECT 1 FROM "PostTarget" AS t WHERE t."postId" = p."id" AND t."status" = 'PUBLISHED')
      ) AND (
        EXISTS (SELECT 1 FROM unnest(p."mediaUrls") AS url WHERE right(url, length(${suffix})) = ${suffix})
        OR EXISTS (
          SELECT 1 FROM jsonb_each_text(
            CASE WHEN jsonb_typeof(p."platformMedia") = 'object' THEN p."platformMedia" ELSE '{}'::jsonb END
          ) AS media(key, url) WHERE right(media.url, length(${suffix})) = ${suffix}
        )
      )
    ) AS visible
  `;
  if (!visibility.visible) {
    const viewer = await getViewer();
    if (!viewer || !canAccessOwnedRecord(viewer, asset.createdById)) return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(Buffer.from(asset.data), {
    headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": visibility.visible ? "public, max-age=31536000, immutable" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
