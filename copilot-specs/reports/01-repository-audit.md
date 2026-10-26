# Task 01 — Read-Only Repository Audit

**Audit date:** 2026-10-26  
**Scope:** Current working-tree snapshot. This audit is observational; no application code, dependencies, schema, migrations, environment files, database, containers, or existing documentation were changed.

## Executive summary

This is an npm-managed Next.js 15 App Router application using React 19, TypeScript, Auth.js v5, PostgreSQL, Prisma, Redis, and BullMQ. It already has `USER`, `ADMIN`, and `SUPER_ADMIN` roles; database-backed sessions; server-side page/action checks; super-admin user, role, session, and activity-log surfaces; and a super-admin dashboard at `/admin/super-admin`.

The most important qualification is that the repository is **not a clean baseline**. `git status --short` reports multiple modified, deleted, and untracked files, including changes to admin routes and a new super-admin dashboard. Findings below describe the checkout as inspected, not necessarily the last committed state.

The configured type-check, tests, production build, and Prisma schema validation all passed. The build reported a non-fatal BullMQ bundling warning. No lint script is configured. A super-admin recovery path and authorization-specific integration tests are notable foundations to resolve or verify before further changes.

## 1. Project architecture and directory map

### Verified stack and entry points

- **Web framework:** Next.js `15.5.4`, App Router, React `19.1.1`; TypeScript `5.9.2` with strict checking and `@/*` mapped to `src/*` (`package.json`, `tsconfig.json`).
- **Package manager:** npm, indicated by `package-lock.json` and npm scripts.
- **Application entry points:** `src/app/layout.tsx` is the root layout; `src/app/page.tsx` is `/`; `src/app/api/auth/[...nextauth]/route.ts` exposes Auth.js handlers; `src/middleware.ts` applies Auth.js middleware.
- **Worker entry point:** `src/worker/index.ts`, run using the `worker` package script.
- **Persistence and queue:** PostgreSQL with Prisma; Redis with BullMQ/ioredis.

### Directory map

| Path | Purpose |
|---|---|
| `src/app/` | App Router pages, layouts, server actions, and route handlers |
| `src/app/(dashboard)/` | Authenticated dashboard route group; the parenthesized group does not appear in URL paths |
| `src/app/(dashboard)/admin/` | Admin pages, actions, controls, logs, user/role management, and super-admin overview |
| `src/app/api/` | Auth, media, upload, webhook, and social-provider route handlers |
| `src/auth.ts`, `src/auth.config.ts`, `src/middleware.ts` | Auth.js providers/callbacks, edge-safe authorization config, and middleware |
| `src/lib/` | Database/session helpers, domain logic, integrations, scheduling, queueing, and tests |
| `src/components/` | Shared interface components, including the dashboard shell and platform components |
| `src/types/` | Auth.js TypeScript module augmentation |
| `src/worker/` | Background publishing/scheduling worker |
| `prisma/` | Prisma schema, seed script, and ordered SQL migrations |
| `scripts/` | User creation, provider checks, and local development helpers |
| `.github/workflows/` | CI workflow |
| `.devcontainer/` | Development-container definition and setup script |

The application is organized around platform/domain helpers rather than a separate service or monorepo package structure. Common UI is mostly composed from the shared dashboard shell and local route components.

## 2. Authentication and authorization flow

### Authentication

1. Auth.js is configured in `src/auth.ts`; the edge-safe subset is in `src/auth.config.ts`.
2. Credentials sign-in validates email/password input, finds the user by normalized email, rejects disabled users or missing password hashes, and verifies the password with bcrypt.
3. Google and Facebook providers are enabled only when their required environment variables are present. Social sign-in logic looks up provider-linked accounts and prevents linking a password-backed staff account by email alone. A test-only mock provider is guarded by `NODE_ENV !== "production"`.
4. On sign-in, the JWT callback creates a `UserSession` row and stores its ID (`sid`) in the token. The session callback loads that database record and its user, rejects missing/revoked/expired sessions and disabled users, and copies the **current database role** into the returned session.
5. Sign-out revokes the associated database session and writes an activity record.

Relevant implementation: `src/auth.ts` (credentials around lines 10–44; social sign-in around 87–121; session creation/checking around 123–173); `src/auth.config.ts` (public paths and coarse middleware decisions around 7–28); `src/middleware.ts` (matcher around line 9).

### Authorization

- Middleware allows the public route set and otherwise checks whether there is a signed-in user. Its role value is used for a post-login landing page, not as the final authorization decision.
- `src/lib/session.ts` is the principal server-side authorization helper:
  - `pageViewer("staff")` permits `ADMIN` and `SUPER_ADMIN`.
  - `pageViewer("super")` permits only `SUPER_ADMIN`.
  - `requireStaff()` and `requireSuperAdmin()` provide action/API-style checks that throw on denial.
- Route pages use `pageViewer`; server actions and route handlers check the session/role server-side. Navigation visibility in the dashboard shell is a UI convenience, not the security boundary.
- The `/admin` dashboard is available to staff. Role/user/log/super-admin pages use the super-admin guard. Admin actions for publishing require staff; session revocation and role changes require super admin.
- `setRole` accepts only `USER` or `ADMIN`; it prevents changing the actor’s own role and refuses to change a `SUPER_ADMIN` account. The role change is recorded in `ActivityLog`.

Relevant files: `src/lib/session.ts:12–64`; `src/app/(dashboard)/admin/actions.ts:23–103`; `src/app/(dashboard)/admin/page.tsx:26`; `src/app/(dashboard)/admin/users/page.tsx:23`; `src/app/(dashboard)/admin/roles/page.tsx:15`; `src/app/(dashboard)/admin/logs/page.tsx:29`; `src/app/(dashboard)/admin/super-admin/page.tsx:27`; `src/components/dashboard-shell.tsx`.

## 3. Database models and relationships

Prisma is present and configured for PostgreSQL (`prisma/schema.prisma:1–9`). Its `Role` enum is `USER`, `ADMIN`, `SUPER_ADMIN` (`schema.prisma:12–16`). The migrations include a role/session-related migration at `prisma/migrations/20261023195907_roles_sessions_advert_subscriptions/migration.sql`.

Relevant models:

- **`User`** (`schema.prisma:66 onward`): unique email, optional bcrypt password hash, `role` defaulting to `USER`, `disabledAt`, profile fields, and relations to linked accounts, sessions, activity, subscriptions, socials, posts, notifications, and audience records.
- **`Account`** (`schema.prisma:407–417`): social provider/account identity, unique by provider and provider account ID; belongs to a user.
- **`UserSession`** (`schema.prisma:419–433`): provider, IP, user agent, creation/last-seen/expiry/revocation times; belongs to a user. Indexed by user and last-seen time.
- **`ActivityLog`** (`schema.prisma:435–451`): action, JSON detail, IP, timestamp, subject user, and optional `actorId`; indexed for user, date, and action queries.
- **`AdvertSubscription`** (`schema.prisma:454–467`): user-to-advert subscription, unique per user/advert/platform.
- **`Subscriber`** (`schema.prisma:312–354`): public WhatsApp subscriber, consent, confirmation, status, and optional linked user.
- **`Campaign`** (`schema.prisma:356–380`): proposed subscriber sends, status, approval fields, and relations to advert/user/deliveries.
- **`Notification`** (`schema.prisma:503–517`): optional associated user and read state.

The broader schema also contains social accounts, posts/targets, channels/schedules, media, deliveries, settings, and related platform enums. No separate permission/capability model is present; authorization is currently based on the three-value role enum and code-level checks.

## 4. Existing admin pages and endpoints

### Pages

| URL | Current purpose/access |
|---|---|
| `/admin` | Staff publishing overview |
| `/admin/adverts` | Adverts; staff |
| `/admin/notifications` | Notifications; staff |
| `/admin/super-admin` | Platform metrics, user list/filtering, and trends; super admin |
| `/admin/users` | User details, subscriptions, sessions, activity; super admin |
| `/admin/roles` | Promote users to admin or demote admins to users; super admin |
| `/admin/logs` | Activity and session views; super admin |

These routes are under `src/app/(dashboard)/admin/`. The shared shell/nav is `src/components/dashboard-shell.tsx`.

### Server actions and route handlers

- `src/app/(dashboard)/admin/actions.ts`: staff publishing actions; super-admin actions for revoking sessions and changing roles.
- `src/app/(dashboard)/admin/notifications/actions.ts`: staff notification actions.
- `src/app/(dashboard)/admin/logs/export/route.ts`: CSV activity-log export with a super-admin check.
- `src/app/api/uploads/route.ts`: staff-only upload.
- `/api/meta/{connect,callback}`, `/api/x/{connect,callback}`, `/api/tiktok/{connect,callback}`: social-account flows that check staff status.
- `src/app/api/auth/[...nextauth]/route.ts`: Auth.js endpoint.
- Additional media and webhook routes exist; middleware explicitly treats media and webhook prefixes as public, with route-level behavior defined in their handlers.

## 5. Configuration, Docker, and environment

- `.env.example` was inspected in a redacted manner to identify configuration names/categories only. It covers database/queue, Auth.js, social providers, token encryption, AI, platform APIs, and scheduling. **No values are reproduced in this report.**
- `.env.local` is present but its contents were not read. The production-build output reported `.env.local` and `.env` as environment sources; no values were printed or inspected.
- `docker-compose.yml` defines local PostgreSQL and Redis services with named persistent storage and host ports. It contains hard-coded local PostgreSQL bootstrap credentials; keep this compose setup development-only and do not reuse those defaults for a deployed service.
- `.devcontainer/docker-compose.yml` defines the app, PostgreSQL, and Redis services. `.devcontainer/setup.sh` copies/edits local environment configuration, installs packages, applies migrations, and seeds the database. It was **not run**.
- `.github/workflows/ci.yml` runs `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`.
- `next.config.ts` externalizes Prisma and bcrypt packages for Node runtime and configures allowed dev origins from an environment variable.
- `package.json` uses the deprecated `package.json#prisma` seed configuration; Prisma validation reports this will be removed in Prisma 7.

## 6. Copilot specifications

Before this requested report was added, no `copilot-specs/` directory or existing files under it were found in the repository.

## 7. Checks and commands

### Executed

| Command | Result |
|---|---|
| `npm.cmd run typecheck` | Passed (`tsc --noEmit`) |
| `npm.cmd test` | Passed. The configured script runs policy, schedule, handle, audience, subscription, prompt, X, and dashboard-series test scripts. |
| `npm.cmd run build` | Passed. Next.js compiled and generated routes. Non-fatal warning: BullMQ `child-processor.js` has a dynamic dependency expression through `src/lib/queue.ts`. |
| `npx.cmd prisma validate` | Passed; schema reported valid. Prisma emitted the `package.json#prisma` deprecation warning. |
| `npm.cmd run lint` | Could not run: npm reported `Missing script: "lint"` in `package.json`. |

The first attempts using `npm` in PowerShell were blocked because the local execution policy prevents loading `npm.ps1`; invoking the same commands as `npm.cmd` succeeded. This was a shell-launch issue, not a project command failure.

### Not run

- `npm ci` / package installation: not run because the task prohibits installing packages.
- Database migrations, seed, database-backed integration checks, or Prisma Studio: not run. The task prohibits database modification, and no live database state or migration status was verified.
- Docker/container startup: not run; no container or volume was created, reset, deleted, or inspected at runtime.
- `.devcontainer/setup.sh`: not run because it installs dependencies and applies migrations/seeds.

## 8. Confirmed facts and risks vs. unverified suspicions

### Confirmed facts and risks

1. **Dirty baseline:** The checkout has pre-existing changes to `README.md`, `docker-compose.yml`, `package.json`, admin pages/actions, the dashboard layout, and the nav component, plus untracked dashboard/UI/test files and `SYSTEM_OVERVIEW.txt`. Therefore, the audit cannot attribute these features to committed history or establish a clean comparison point.
2. **Super-admin recovery limitation:** The role action intentionally cannot change a `SUPER_ADMIN` account. The seed script (`prisma/seed.ts`) uses `upsert` with an empty `update` object, so rerunning it does not restore a seeded account’s `SUPER_ADMIN` role if that account already exists with a different role. No in-app recovery path was found. Define and test an authorized recovery/provisioning process before relying on this role as the only administrative authority.
3. **Audit-log failure behavior:** In `src/app/(dashboard)/admin/actions.ts`, `publish` suppresses activity-log errors with `.catch(() => null)` after publishing succeeds. A successful publish can therefore have no corresponding audit record without surfacing a logging failure. Role changes update the user and then write the audit event as separate operations; if the latter fails, the role change may have persisted even though the action reports an error. These are code-path risks; no such runtime failure was induced.
4. **Authorization tests are missing from the configured test command:** the `npm test` script lists utility/domain scripts but no auth/session/role-guard integration tests. Type-check/build success does not verify denial behavior for each page, action, and API.
5. **No lint command:** confirmed by the missing `lint` npm script and failed `npm.cmd run lint`.
6. **Development credentials are embedded in compose configuration:** compose files should remain local-development configuration; no production deployment configuration was assessed.
7. **Build warning:** the BullMQ dynamic dependency warning is reproducible during build but did not fail compilation. Its runtime impact was not tested.
8. **Prisma configuration deprecation:** schema validation succeeds, but the configured package-level seed setting is deprecated for Prisma 7.

### Unverified or deployment-dependent

- Whether deployed PostgreSQL/Redis services are available, migrations are applied, and the required Auth.js/provider/API environment variables are configured.
- Whether the proxy in each deployment sanitizes `cf-connecting-ip` and `x-forwarded-for`. The code reads these request headers for IP logging; trustworthiness depends on the proxy/network configuration.
- Whether route and role behavior has adequate end-to-end coverage in external CI or a deployed environment. Only the repository’s configured local test scripts were run.
- Whether the BullMQ warning causes any production issue; the observed evidence is limited to a successful build with that warning.

## 9. Recommended implementation order and dependencies

1. **Establish the intended baseline.** Review/resolve the existing uncommitted admin/dashboard changes before using this checkout as the starting point for additional Super Admin work.
2. **Confirm the authorization matrix and recovery ownership.** Document which operations are staff-only versus super-admin-only, and decide how a lost/disabled final super-admin account is recovered. Preserve database-backed role checks; do not rely on navigation or middleware role hints.
3. **Reuse existing foundations.** Use the `Role` enum, `User.disabledAt`, `UserSession`, and `ActivityLog` where their semantics fit. Avoid schema/migration work unless the required behavior cannot be represented by these models.
4. **Implement server-side behavior before UI.** Put sensitive mutations behind `requireSuperAdmin`, validate target IDs/roles, handle self/last-super-admin cases deliberately, and define how the mutation and audit record succeed or fail together.
5. **Wire pages and navigation to the guarded actions.** Keep `pageViewer("super")` checks on pages and preserve API/action authorization independently of shell visibility.
6. **Add focused authorization and recovery tests.** Cover signed-out, user, admin, and super-admin access; revocation/current-role behavior; prohibited self/last-super-admin transitions; and audit failure/partial-write behavior.
7. **Run validation in order:** focused tests, `npm run typecheck`, full `npm test`, `npm run build`, and Prisma validation if schema work is introduced. Use a controlled test database for any integration tests; do not run migration/seed operations against an unknown environment.

## 10. Files inspected

Read or queried for relevant symbols/configuration:

- `package.json`, `package-lock.json` presence, `README.md` (searched for role/seeding references), `SYSTEM_OVERVIEW.txt`
- `next.config.ts`, `tsconfig.json`, `.env.example` (redacted inspection)
- `docker-compose.yml`, `.devcontainer/docker-compose.yml`, `.devcontainer/devcontainer.json`, `.devcontainer/setup.sh`, `.github/workflows/ci.yml`
- `src/auth.ts`, `src/auth.config.ts`, `src/middleware.ts`, `src/lib/session.ts`, `src/types/next-auth.d.ts`
- `src/app/(dashboard)/layout.tsx`, `src/components/dashboard-shell.tsx`
- `src/app/login/actions.ts`
- `src/app/(dashboard)/admin/page.tsx`, `actions.ts`, `buttons.tsx`, `users/page.tsx`, `roles/page.tsx`, `logs/page.tsx`, `logs/export/route.ts`, `super-admin/page.tsx`, `super-admin/loading.tsx`, `super-admin/error.tsx`
- Role-check references across `src/app/api/` and `src/app/(dashboard)/`
- `prisma/schema.prisma`, `prisma/seed.ts`, and the role/session migration
- Repository structure and working-tree state via `git ls-files` and `git status --short`

`.env.local` was not opened, and no values from any environment file are included here.

## Summary

The current checkout already includes a complete basic Super Admin surface supported by enum-based roles, database-validated sessions, server-side guards, role/session actions, and activity logs. Type-check, configured tests, production build, and Prisma validation pass. Before extending it, resolve the dirty-baseline ambiguity, define a safe super-admin recovery mechanism, and add authorization-focused tests; also address the audit-log failure semantics where appropriate. No implementation beyond this audit report was performed.
