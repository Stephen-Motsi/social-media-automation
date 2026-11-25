BEGIN;

ALTER TABLE "WhatsappSession" ADD COLUMN "activeIdentity" TEXT;

-- Active or recoverable legacy sessions must be identified before rollout.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "WhatsappSession"
    WHERE ("status" = 'WORKING' OR ("recoveryEnabled" AND "accountId" IS NOT NULL))
      AND (
        "accountId" IS NULL OR
        lower(trim("accountId")) !~ '^[0-9]{8,15}(:[0-9]+)?@(c[.]us|s[.]whatsapp[.]net)$'
          AND trim("accountId") !~ '^[0-9]{8,15}$'
      )
  ) THEN
    RAISE EXCEPTION 'Cannot identify an active or recoverable WhatsApp session; reconcile WAHA identities before applying this migration';
  END IF;
END $$;

UPDATE "WhatsappSession"
SET "activeIdentity" = substring(trim("accountId") FROM '^([0-9]{8,15})')
WHERE ("status" = 'WORKING' OR ("recoveryEnabled" AND "accountId" IS NOT NULL));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "WhatsappSession" WHERE "activeIdentity" IS NOT NULL
    GROUP BY "activeIdentity" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active WhatsApp identities detected; reconcile sessions before applying this migration';
  END IF;
END $$;

ALTER TABLE "WhatsappSession" ADD CONSTRAINT "WhatsappSession_activeIdentity_format_check"
  CHECK ("activeIdentity" IS NULL OR "activeIdentity" ~ '^[0-9]{8,15}$');
ALTER TABLE "WhatsappSession" ADD CONSTRAINT "WhatsappSession_working_identity_check"
  CHECK ("status" <> 'WORKING' OR "activeIdentity" IS NOT NULL);
ALTER TABLE "WhatsappSession" ADD CONSTRAINT "WhatsappSession_identity_matches_account_check"
  CHECK ("activeIdentity" IS NULL OR (
    "accountId" IS NOT NULL
    AND (lower(trim("accountId")) ~ '^[0-9]{8,15}(:[0-9]+)?@(c[.]us|s[.]whatsapp[.]net)$'
      OR trim("accountId") ~ '^[0-9]{8,15}$')
    AND substring(trim("accountId") FROM '^([0-9]{8,15})') = "activeIdentity"
  ));
CREATE UNIQUE INDEX "WhatsappSession_activeIdentity_key" ON "WhatsappSession"("activeIdentity");

COMMIT;
