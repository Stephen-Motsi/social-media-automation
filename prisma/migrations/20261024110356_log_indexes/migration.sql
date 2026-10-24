-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "public"."ActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_action_createdAt_idx" ON "public"."ActivityLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "UserSession_lastSeenAt_idx" ON "public"."UserSession"("lastSeenAt");

