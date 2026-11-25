BEGIN;

ALTER TABLE "PostTarget" DROP CONSTRAINT "PostTarget_accountId_fkey";
ALTER TABLE "PostTarget" ADD CONSTRAINT "PostTarget_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
