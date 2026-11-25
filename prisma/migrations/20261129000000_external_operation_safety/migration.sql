ALTER TYPE "TargetStatus" ADD VALUE IF NOT EXISTS 'IN_FLIGHT';
ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'IN_FLIGHT';

CREATE TABLE "WahaOperationLock" (
    "sessionName" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WahaOperationLock_pkey" PRIMARY KEY ("sessionName")
);

CREATE TABLE "TokenRefreshAttempt" (
    "key" TEXT NOT NULL,
    "generation" TEXT NOT NULL,
    "previousAccessToken" TEXT,
    "previousRefreshToken" TEXT,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TokenRefreshAttempt_pkey" PRIMARY KEY ("key")
);
