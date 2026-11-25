-- Existing shared records remain unowned and available to staff.
BEGIN;
ALTER TABLE "public"."SocialAccount" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "public"."ChannelGroup" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "public"."Channel" ADD COLUMN "ownerId" TEXT;

ALTER TABLE "public"."SocialAccount" ADD CONSTRAINT "SocialAccount_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."ChannelGroup" ADD CONSTRAINT "ChannelGroup_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."Channel" ADD CONSTRAINT "Channel_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "public"."ChannelGroup_kind_key";
DROP INDEX "public"."Channel_platform_key";
CREATE UNIQUE INDEX "ChannelGroup_ownerId_kind_key" ON "public"."ChannelGroup"("ownerId", "kind");
CREATE UNIQUE INDEX "ChannelGroup_id_ownerId_key" ON "public"."ChannelGroup"("id", "ownerId");
CREATE UNIQUE INDEX "Channel_ownerId_platform_key" ON "public"."Channel"("ownerId", "platform");
CREATE UNIQUE INDEX "ChannelGroup_legacy_kind_key" ON "public"."ChannelGroup"("kind") WHERE "ownerId" IS NULL;
CREATE UNIQUE INDEX "Channel_legacy_platform_key" ON "public"."Channel"("platform") WHERE "ownerId" IS NULL;
CREATE INDEX "SocialAccount_ownerId_platform_idx" ON "public"."SocialAccount"("ownerId", "platform");

-- A user-owned channel cannot reference a different owner's group.
ALTER TABLE "public"."Channel" ADD CONSTRAINT "Channel_group_owner_fkey"
  FOREIGN KEY ("groupId", "ownerId") REFERENCES "public"."ChannelGroup"("id", "ownerId")
  ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;
