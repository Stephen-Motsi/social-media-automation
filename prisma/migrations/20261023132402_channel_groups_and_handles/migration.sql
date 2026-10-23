/*
  Warnings:

  - Added the required column `groupId` to the `Channel` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."GroupKind" AS ENUM ('META', 'X', 'TIKTOK');

-- AlterTable
ALTER TABLE "public"."Channel" ADD COLUMN     "groupId" TEXT NOT NULL,
ADD COLUMN     "handle" TEXT;

-- AlterTable
ALTER TABLE "public"."SocialAccount" ADD COLUMN     "handle" TEXT,
ADD COLUMN     "profileUrl" TEXT;

-- CreateTable
CREATE TABLE "public"."ChannelGroup" (
    "id" TEXT NOT NULL,
    "kind" "public"."GroupKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelGroup_kind_key" ON "public"."ChannelGroup"("kind");

-- AddForeignKey
ALTER TABLE "public"."Channel" ADD CONSTRAINT "Channel_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."ChannelGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
