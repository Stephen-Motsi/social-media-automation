CREATE TABLE "WhatsappSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STOPPED',
    "accountName" TEXT,
    "accountId" TEXT,
    "accountPhone" TEXT,
    "accountPushName" TEXT,
    "accountInfo" JSONB,
    "webhookSecretEncrypted" TEXT NOT NULL,
    "lastStatusAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappSession_userId_key" ON "WhatsappSession"("userId");
CREATE UNIQUE INDEX "WhatsappSession_sessionName_key" ON "WhatsappSession"("sessionName");
ALTER TABLE "WhatsappSession" ADD CONSTRAINT "WhatsappSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
