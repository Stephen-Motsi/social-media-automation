CREATE TYPE "WhatsappRequestStatus" AS ENUM ('PENDING', 'PREPARING', 'IN_PROGRESS', 'EXPIRING', 'CONNECTED', 'EXPIRED', 'FAILED', 'CANCELLED');

ALTER TABLE "SocialAccount" ADD COLUMN "disconnectedAt" TIMESTAMP(3);

CREATE TABLE "WhatsappConnectionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "WhatsappRequestStatus" NOT NULL DEFAULT 'PENDING',
    "qrExpiresAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsappConnectionRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappConnectionRequest_userId_key" ON "WhatsappConnectionRequest"("userId");
CREATE INDEX "WhatsappConnectionRequest_status_updatedAt_idx" ON "WhatsappConnectionRequest"("status", "updatedAt");
ALTER TABLE "WhatsappConnectionRequest" ADD CONSTRAINT "WhatsappConnectionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
