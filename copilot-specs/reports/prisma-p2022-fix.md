# Prisma P2022 and Homepage HTTP 500 Fix

## Confirmed root cause

`Post.creativeBrief` was present in `prisma/schema.prisma` and in an existing migration, but the migration had not been applied to the configured database. The runtime database reported the migration as unapplied, and Prisma expected the generated JSON column because the schema is now legitimate application state.

Confirmed:

- Prisma Client/CLI version: `6.16.2`
- Provider: PostgreSQL
- Configured database: `social_automation`, public schema
- Prisma migration status before the fix identified one unapplied migration:
  `20261028095403_advert_creative_brief`
- Migration SQL is additive: `ALTER TABLE "Post" ADD COLUMN "creativeBrief" JSONB;`
- Direct metadata query afterward confirmed `creativeBrief` is nullable JSONB (`is_nullable = YES`).

No evidence indicated stale generated-client state, a wrong database selection, or an obsolete field. The migration was created from the legitimate creative-brief feature, so Case A applied.

## Data and migration handling

Before applying the migration, attempted to create a logical database backup with `pg_dump`, but `pg_dump` is not installed and installation is blocked by filesystem permissions in the environment. The migration is backward-compatible and nullable, adding only a JSONB column without rewriting or deleting existing rows.

Migration applied using the established deployment workflow:

```text
npx prisma migrate deploy
```

Prisma Client was then regenerated with `npx prisma generate`.

## Files changed

- `src/lib/adverts.ts`
  - Removed the static top-level `schedulePost` import.
  - Queue loading now happens dynamically only at the publishing operation that needs it.
  - This reduces public advert/query module coupling to BullMQ, while queue behavior remains server-side and unchanged.
- `copilot-specs/reports/prisma-p2022-fix.md`
  - Added this diagnosis, verification record, and rollback guidance.

No migration file was created because the repository already contained a valid migration for the field.

## BullMQ warning investigation

The homepage-specific static BullMQ dependency through `src/lib/adverts.ts` was addressed by replacing the static queue import with a dynamic server-side import at the publishing call.

A production build still reports the known Webpack `Critical dependency: the request of a dependency is an expression` warning for BullMQ. The final trace from the build was:

```text
node_modules/bullmq/dist/esm/classes/child-processor.js
→ classes/index.js
→ bullmq/dist/esm/index.js
→ src/lib/queue.ts
→ src/lib/channels.ts
→ src/app/(dashboard)/admin/page.tsx
```

Confirmed facts:

- BullMQ modules remain server-side queue functionality.
- `src/lib/channels.ts` still imports `src/lib/queue.ts` statically for channel scheduling.
- Other server modules also import queue operations statically where needed.
- The warning originates in BullMQ's child processor dynamic dependency handling, not a homepage database failure.
- No Browser/client import of BullMQ was introduced.

No Webpack warning suppression or speculative queue removal was made. Further restructuring was not justified because channel scheduling and queue operations are necessary server behavior, and runtime behavior is not broken by this warning.

## Commands and real results

- `git status --short`
  - Preserved the pre-existing worktree changes and identified the migration/schema changes already present.
- `npm ls prisma @prisma/client --depth=0`
  - Both packages are `6.16.2`.
- `npx prisma validate`
  - Passed: schema valid.
- `npx prisma migrate status`
  - Before deployment: migration `20261028095403_advert_creative_brief` unapplied.
- `pg_dump` attempt
  - Failed because `pg_dump` is unavailable; package installation was blocked.
- `npx prisma migrate deploy`
  - Applied `20261028095403_advert_creative_brief` successfully.
- `npx prisma generate`
  - Generated Prisma Client `6.16.2` successfully.
- `npx prisma migrate status`
  - Passed: database schema is up to date.
- Direct Prisma information-schema query
  - Returned `creativeBrief`, type `jsonb`, nullable `YES`.
- Direct `listedAdverts()` query
  - Returned `count: 0` for the current database without a P2022 error.
- `npm run typecheck`
  - Passed.
- `npm test`
  - Passed, including the platform advert compositor suite.
- `npm run build`
  - Passed and generated all 14 routes successfully.
  - Non-fatal warnings remain: BullMQ critical dependency and Auth.js/Jose Edge Runtime API warnings.
- Development server on port `3101`
  - `GET /` returned HTTP `200`.
  - Homepage content contained the expected heading.
  - `GET /me` returned the expected authentication redirect (`307`) for an unauthenticated request.

## Users-page follow-up verification

A separate port-5433 local database is configured in `.env` and `.env.local`, but that database was not running and Docker was unavailable in this environment. The running application process was therefore verified and restarted against the shell-selected `postgres:5432` target, which is the database where `migrate deploy` successfully applied the creative-brief migration.

- `GET /me` from the restarted development server returned a `307` authentication redirect, not P2022.
- `listedAdverts()` against the active target returned successfully with zero adverts in the current database.
- The browser `/me` request is redirected to the configured login callback rather than rendering a database error.
- The homepage remained HTTP 200 after the restart.

## Remaining uncertainty

- No database snapshot could be created because `pg_dump` is unavailable and package installation is blocked.
- The `localhost:5433` development database service could not be started because Docker is unavailable. This is a separate local-development target from the shell-selected database target and should be reconciled before relying on port 5433 for local work.
- The migration only adds a nullable JSONB column and no data migration is required.
- Live queue processing, social publishing, and live provider credentials were not exercised.
- The BullMQ warning remains a build warning, but the production build completed and the warning was isolated to server-side queue modules.
- The `/me` unauthenticated redirect used the configured callback host; authenticated `/me` behavior should be rechecked with a valid session in the intended environment.

## Safe rollback

Database rollback should only be considered if the feature is also reverted and existing rows do not contain data that depends on `creativeBrief`.

1. Revert the source changes associated with creative briefs if required, excluding unrelated worktree changes.
2. Check for migration application records and downstream data before making further changes.
3. If explicitly approved, remove the column with a reviewed forward SQL migration containing:
   ```sql
   ALTER TABLE "Post" DROP COLUMN IF EXISTS "creativeBrief";
   ```
4. Regenerate Prisma Client with `npx prisma generate`.
5. Do not manually delete the applied migration record or edit migration history.
6. Do not run `prisma migrate reset` or `prisma db push`.
7. Re-run migration status, the Prisma query, `/`, `/me`, and the production build.
