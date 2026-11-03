ALTER TABLE "WhatsappSession"
ADD COLUMN "authMethod" TEXT,
ADD COLUMN "pairingCode" TEXT,
ADD COLUMN "pairingCodeRequestedAt" TIMESTAMP(3),
ADD COLUMN "pairingCodeExpiresAt" TIMESTAMP(3);
