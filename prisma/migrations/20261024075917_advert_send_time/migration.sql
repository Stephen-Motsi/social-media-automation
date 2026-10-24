-- AlterTable
ALTER TABLE "public"."Campaign" ADD COLUMN     "sendAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."Post" ADD COLUMN     "autoSend" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sendAt" TIMESTAMP(3);

