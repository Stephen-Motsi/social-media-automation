-- AlterTable
ALTER TABLE "public"."Post" ADD COLUMN     "sourceAdvertId" TEXT;

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "whatsappCode" TEXT,
ADD COLUMN     "whatsappPending" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_whatsappCode_key" ON "public"."User"("whatsappCode");

-- AddForeignKey
ALTER TABLE "public"."Post" ADD CONSTRAINT "Post_sourceAdvertId_fkey" FOREIGN KEY ("sourceAdvertId") REFERENCES "public"."Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

