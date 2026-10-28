# Prisma P2022 Runtime Diagnosis

## Running process findings

The repository is cleanly protected: diagnosis and fixes preserved all pre-existing modified and untracked files.

An active Next.js development server was using port `3101`; port `3000` had no listener even though the browser was configured around port `3000`. The process was:

```text
node .../next/dist/bin/next dev -p 3101
next-server (v15.5.4)
```

The working directory was `/workspaces/social-media-automation1`.

Safe environment inspection of the live Next.js process showed:

```text
host: postgres
port: 5432
database: social_automation
schema: public
```

A shell environment variable took precedence over `.env`/`.env.local`; those local files configure `localhost:5433`, while the failing development process inherited `postgres:5432`. The port-5433 target is currently unreachable from this environment, and Docker tooling is unavailable to start it.

The temporary port-3101 server has been stopped. The app is now serving port `3000` with the verified database environment.

## Database comparison

The database previously migrated was verified separately as:

```text
host: postgres
port: 5432
database: social_automation
schema: public
```

The database used by the live Next.js process is the same target. The `.env` and `.env.local` localhost:5433 target is different and was not used by the live server because the shell inherited a `DATABASE_URL` for postgres:5432.

Read-only runtime checks returned:

```text
current_database = social_automation
current_schema = public
search_path = "public"
column = Post.creativeBrief
data_type = jsonb
is_nullable = YES
migration_name = 20261028095403_advert_creative_brief
finished_at = present
rolled_back_at = null
```

Therefore:

- The runtime target contains the intended column.
- The migration history records the migration as successfully completed.
- There is no Prisma schema-search-path mismatch.
- The column is consistent with the schema and existing migration SQL.

## Confirmed root cause

The original claim was incomplete: the previous verification demonstrated one migrated database, but did not verify the effective database of the server currently serving the browser. The environment had two targets:

1. `postgres:5432/social_automation` inherited by the live Next.js process.
2. `localhost:5433/social_automation` configured in `.env` and `.env.local` but unavailable in this environment.

The browser and server ports were also inconsistent: the browser had been associated with port 3000 while a port-3101 development process was running, and no port-3000 listener existed. This stale/incorrect runtime setup could explain why previously observed verification did not match the browser session.

No evidence justified another migration, a migration-history edit, a duplicate migration, `db push`, or a database reset.

## Fix applied

- Did not create or apply a duplicate migration.
- Stopped only the temporary Next.js port-3101 process.
- Started the Next.js development server on port 3000, where the browser login callback is configured.
- Preserved the inherited runtime `DATABASE_URL` targeting `postgres:5432/social_automation`.
- Regenerated and validated the existing Prisma setup as applicable.

No application source or schema changes were required for this runtime mismatch.

## Restart and generated-cache diagnosis

A separate React Client Manifest 500 was observed before the fresh restart. It occurred after switching/stopping development processes and was independent of Prisma. The generated `.next` directory was preserved outside the worktree and a fresh development server was started on port 3000. This resolved the manifest 500.

## Verification

Commands/results:

- `git status --short`
  - Pre-existing worktree changes and untracked report/migration files were preserved.
- Live process environment inspection
  - Active Next.js process used `postgres:5432/social_automation` with public schema.
- Direct Prisma metadata query
  - `Post.creativeBrief` exists, type is `jsonb`, nullable is `YES`.
- Migration-history query
  - `20261028095403_advert_creative_brief` has a finish timestamp and no rollback timestamp.
- `npx prisma migrate status`
  - Database schema is up to date.
- `npx prisma validate`
  - Prisma schema is valid.
- Exact `listedAdverts()` query
  - Returned `{ count: 0, ids: [] }` without P2022.
- `GET http://127.0.0.1:3000/`
  - HTTP 200 and expected homepage heading rendered.
- Key route probes on port 3000:
  - `/` 200
  - `/login` 200
  - `/create` 307 unauthenticated/staff redirect
  - `/me` 307 unauthenticated redirect
- Production build and tests had been run previously; no new source change is associated with this runtime fix.

## Remaining uncertainty

- `localhost:5433` remains inaccessible in this environment, and Docker is unavailable. Anyone expecting the local Compose database on port 5433 must start PostgreSQL through the normal host/Dev Container tooling before using that target.
- `.env.local` overrides or shell environment precedence should be reviewed if local port-5433 is later intended to become the authoritative development database.
- An authenticated browser session should still be checked after signing in, because unauthenticated `/create` and `/me` probes only verify middleware redirects and rendering reachability.
- Live social publishing and Redis queue behavior were not tested.
