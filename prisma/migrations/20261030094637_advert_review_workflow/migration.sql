CREATE TYPE "AdvertReviewStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

ALTER TABLE "Post"
  ADD COLUMN "reviewStatus" "AdvertReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "reviewReason" TEXT;

ALTER TABLE "Post"
  ADD CONSTRAINT "Post_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Post_reviewStatus_idx" ON "Post"("reviewStatus");

-- Preserve already-published legacy adverts while placing all unpublished/generated adverts in review.
UPDATE "Post"
SET "reviewStatus" = 'APPROVED',
    "reviewedAt" = COALESCE("listedAt", "updatedAt"),
    "reviewReason" = 'Approved by the legacy publishing workflow before mandatory review was enabled.'
WHERE "listedAt" IS NOT NULL AND "channelId" IS NULL;
