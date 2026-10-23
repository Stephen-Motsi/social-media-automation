-- AlterEnum
BEGIN;
CREATE TYPE "public"."Role_new" AS ENUM ('USER', 'ADMIN', 'SUPER_ADMIN');
ALTER TABLE "public"."User" ALTER COLUMN "role" DROP DEFAULT;
-- MEMBER (old read-only staff) becomes USER
ALTER TABLE "public"."User" ALTER COLUMN "role" TYPE "public"."Role_new" USING ((CASE "role"::text WHEN 'MEMBER' THEN 'USER' ELSE "role"::text END)::"public"."Role_new");
ALTER TYPE "public"."Role" RENAME TO "Role_old";
ALTER TYPE "public"."Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
ALTER TABLE "public"."User" ALTER COLUMN "role" SET DEFAULT 'USER';
COMMIT;

-- AlterTable
ALTER TABLE "public"."Post" ADD COLUMN     "about" TEXT,
ADD COLUMN     "listedAt" TIMESTAMP(3),
ADD COLUMN     "targetPlatforms" "public"."Platform"[],
ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "public"."Subscriber" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "image" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL,
ALTER COLUMN "role" SET DEFAULT 'USER';

-- CreateTable
CREATE TABLE "public"."Account" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserSession" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ActivityLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "actorId" TEXT,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AdvertSubscription" (
    "id" TEXT NOT NULL,
    "platform" "public"."Platform" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "advertId" TEXT NOT NULL,

    CONSTRAINT "AdvertSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "public"."Account"("provider", "providerAccountId");

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "public"."UserSession"("userId");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_createdAt_idx" ON "public"."ActivityLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AdvertSubscription_advertId_platform_idx" ON "public"."AdvertSubscription"("advertId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "AdvertSubscription_userId_advertId_platform_key" ON "public"."AdvertSubscription"("userId", "advertId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "Subscriber_userId_key" ON "public"."Subscriber"("userId");

-- AddForeignKey
ALTER TABLE "public"."Subscriber" ADD CONSTRAINT "Subscriber_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AdvertSubscription" ADD CONSTRAINT "AdvertSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AdvertSubscription" ADD CONSTRAINT "AdvertSubscription_advertId_fkey" FOREIGN KEY ("advertId") REFERENCES "public"."Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The first admin account becomes the super admin
UPDATE "public"."User" SET "role" = 'SUPER_ADMIN'
WHERE "id" = (SELECT "id" FROM "public"."User" WHERE "role" = 'ADMIN' ORDER BY "createdAt" ASC LIMIT 1);
