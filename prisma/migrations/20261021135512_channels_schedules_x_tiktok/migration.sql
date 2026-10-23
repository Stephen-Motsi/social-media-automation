-- CreateEnum
CREATE TYPE "public"."PostFormat" AS ENUM ('POST', 'STORY');

-- CreateEnum
CREATE TYPE "public"."Frequency" AS ENUM ('ONCE', 'DAILY', 'WEEKLY', 'MONTHLY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."Platform" ADD VALUE 'X';
ALTER TYPE "public"."Platform" ADD VALUE 'TIKTOK';

-- AlterTable
ALTER TABLE "public"."Post" ADD COLUMN     "channelId" TEXT;

-- AlterTable
ALTER TABLE "public"."PostTarget" ADD COLUMN     "format" "public"."PostFormat" NOT NULL DEFAULT 'POST';

-- AlterTable
ALTER TABLE "public"."SocialAccount" ADD COLUMN     "refreshTokenEncrypted" TEXT;

-- CreateTable
CREATE TABLE "public"."Channel" (
    "id" TEXT NOT NULL,
    "platform" "public"."Platform" NOT NULL,
    "format" "public"."PostFormat" NOT NULL DEFAULT 'POST',
    "advertId" TEXT,
    "frequency" "public"."Frequency" NOT NULL DEFAULT 'DAILY',
    "runAt" TIMESTAMP(3),
    "timeOfDay" TEXT NOT NULL DEFAULT '09:00',
    "weekdays" INTEGER[],
    "dayOfMonth" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "whatsappRecipients" TEXT[],
    "whatsappTemplate" TEXT,
    "whatsappTemplateLang" TEXT NOT NULL DEFAULT 'en_US',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Channel_platform_key" ON "public"."Channel"("platform");

-- CreateIndex
CREATE INDEX "Channel_enabled_nextRunAt_idx" ON "public"."Channel"("enabled", "nextRunAt");

-- AddForeignKey
ALTER TABLE "public"."Post" ADD CONSTRAINT "Post_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "public"."Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Channel" ADD CONSTRAINT "Channel_advertId_fkey" FOREIGN KEY ("advertId") REFERENCES "public"."Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
