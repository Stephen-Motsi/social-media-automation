-- AlterTable
ALTER TABLE "Subscriber" ADD COLUMN     "addedById" TEXT,
ADD COLUMN     "checks" JSONB,
ADD COLUMN     "confirmCode" TEXT,
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedBy" TEXT,
ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- CreateIndex
CREATE UNIQUE INDEX "Subscriber_confirmCode_key" ON "Subscriber"("confirmCode");

-- AddForeignKey
ALTER TABLE "Subscriber" ADD CONSTRAINT "Subscriber_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
