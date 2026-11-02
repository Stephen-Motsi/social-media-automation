ALTER TABLE "WhatsappSession"
ADD COLUMN "previousStatus" TEXT,
ADD COLUMN "qrGeneratedAt" TIMESTAMP(3),
ADD COLUMN "qrExpiresAt" TIMESTAMP(3),
ADD COLUMN "lastError" TEXT,
ADD COLUMN "recoveryEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "recoveryAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastRecoveryAt" TIMESTAMP(3),
ADD COLUMN "stateVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "WebhookEvent" ADD COLUMN "fingerprint" TEXT;
CREATE UNIQUE INDEX "WebhookEvent_fingerprint_key" ON "WebhookEvent"("fingerprint");
