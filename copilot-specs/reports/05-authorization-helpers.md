# Task 05 — Authorization Helpers

**Implementation date:** 2026-10-27  
**Scope:** Refine existing server-side authorization helpers and add focused unit tests. No authentication provider, session strategy, role model, schema, migration, or user account was changed.

## 1. Existing authorization architecture

The application uses Auth.js / NextAuth v5 with a JWT cookie and a custom Prisma `UserSession` record. The full Auth.js `session` callback checks the session record against PostgreSQL, rejects missing, revoked, expired, disabled, or mismatched sessions, and supplies the user's current database role. See [`src/auth.ts`](../../src/auth.ts#L154-L172).

The existing server-side authorization module is [`src/lib/session.ts`](../../src/lib/session.ts). Its `getViewer()` calls server-side `auth()`; `pageViewer()` redirects for pages, while `requireViewer()`, `requireStaff()`, and `requireSuperAdmin()` throw `AccessError` for server actions and API-style operations. `USER`, `ADMIN`, and `SUPER_ADMIN` are the existing Prisma `Role` values. No competing auth or permission system was introduced.

The authentication and role map at [`04-authentication-and-role-map.md`](./04-authentication-and-role-map.md) was present and reviewed. Reports 02 and 03 were not present in the repository.

## 2. Requirements implemented

- Keep the existing Auth.js server context as the only source used by the async request authorization helpers.
- Fail closed if session identity is absent or malformed, or if the role is not one of the known database role values.
- Keep separate helpers for authenticated, staff, and Super Admin access.
- Preserve `AccessError` and its safe, non-sensitive denial messages.
- Add unit tests for authentication/role decisions, malformed identity, and error messages.

## 3. Helper functions created or modified

In [`src/lib/session.ts`](../../src/lib/session.ts):

- `getViewer()` now checks that the Auth.js session user has a non-empty ID, email, and session ID; nullable/string name and image fields; and one of the existing roles. Invalid values return `null` rather than being cast into a complete `Viewer`.
- `requireAuthenticatedViewer(viewer)` validates a viewer and throws `AccessError("Please sign in again.")` for absent or malformed identity.
- `requireStaffViewer(viewer)` applies the existing `ADMIN`/`SUPER_ADMIN` rule and throws the existing safe staff-denial error otherwise.
- `requireSuperAdminViewer(viewer)` applies the exact `SUPER_ADMIN` rule and throws the existing safe Super Admin denial otherwise.
- The established zero-argument `requireViewer()`, `requireStaff()`, and `requireSuperAdmin()` remain the request-facing helpers. Each obtains its principal from `getViewer()` and delegates to the corresponding assertion; callers cannot pass request parameters, headers, or client role claims to those helpers.
- `AccessError` and `isStaff` retain their existing purpose and role semantics.

The synchronous assertion functions are policy checks over the trusted viewer returned by `getViewer()`. They are in the server session module and must not be passed request data. The request-facing async wrappers do not accept caller-supplied identities.

## 4. File paths and responsibilities

- [`src/lib/session.ts`](../../src/lib/session.ts): trusted server identity read, runtime viewer validation, and authenticated/staff/Super Admin guard functions.
- [`src/lib/session.test.ts`](../../src/lib/session.test.ts): focused unit cases using synthetic `Viewer` values to test the guard policy. These do not simulate a real Auth.js request or database.
- [`package.json`](../../package.json#L5-L18): adds the focused test file to the existing `npm test` chain.
- [`copilot-specs/reports/05-authorization-helpers.md`](./05-authorization-helpers.md): this implementation and verification report.

## 5. Trusted identity and Super Admin verification

Production `requireSuperAdmin()` takes no arguments and calls `getViewer()`, which in turn calls Auth.js `auth()` in the server context. Auth.js's server session callback looks up the signed token's session ID in `UserSession`, checks that it remains valid and belongs to the token identity, rejects disabled users, and populates the current database role. The guard then requires exactly `SUPER_ADMIN`; middleware JWT role copies and client-submitted fields are not used by this helper.

The viewer shape check is defense in depth after Auth.js: missing IDs/session IDs/emails, malformed profile fields, and unknown roles fail as unauthenticated. It does not replace Auth.js session signature or database validation.

Unit tests exercise the synchronous policy assertions with synthetic records; they establish guard behavior, not integration with cookies, Auth.js, Prisma, middleware, or HTTP response codes. No live database or user record was used.

## 6. Unauthorized request handling

- Missing or malformed identity: `AccessError("Please sign in again.")`.
- Authenticated non-staff user on a staff operation: `AccessError("Only admins can do this.")`.
- Authenticated non-Super Admin on a Super Admin operation: `AccessError("Only the super admin can do this.")`.
- Page-level handling remains unchanged: `pageViewer()` redirects unauthenticated viewers to login and insufficiently privileged viewers to the appropriate user/staff page.

No sensitive internals are included in these denial messages. Existing callers retain the same error class and message semantics.

## 7. Tests added or modified

Added `src/lib/session.test.ts`, following the repository's existing direct `tsx` test convention. It covers:

1. Missing viewer rejection.
2. `USER` and `ADMIN` rejection from Super Admin access.
3. `SUPER_ADMIN` acceptance for Super Admin and staff checks.
4. `ADMIN` acceptance for staff checks.
5. Malformed/missing ID, email, session ID, and unknown role rejection.
6. Safe `AccessError` messages.
7. A role-only client-style claim cannot pass without the required viewer identity.

These are unit tests over the helper policy, not real authentication integration tests. No dedicated Auth.js request, cookie, revoked-session, or database integration test was added.

## 8. Exact test commands and results

- `npm exec tsx -- src/lib/session.test.ts` — **PASS**, 11 authorization assertions.
- `npm test` — **PASS**, all existing project test scripts and the new session authorization test completed successfully.
- `npm run typecheck` — **PASS**, `tsc --noEmit`.
- `git diff --check -- package.json src/lib/session.ts src/lib/session.test.ts` — **PASS** after line-ending normalization.

The existing test suite has no separate baseline-auth test suite. No baseline test failures were observed in the successful complete run.

## 9. Failures and diagnosis

### Initial focused test command

The first `npm exec tsx -- src/lib/session.test.ts` attempt failed before loading the test. Relevant output:

```text
Error:
You installed esbuild for another platform than the one you're currently using.
...
Specifically the "@esbuild/win32-x64" package is present but this platform needs the "@esbuild/linux-x64" package instead.
...
at generateBinPath (.../node_modules/esbuild/lib/main.js:1739:17)
...
Node.js v22.16.0
```

**Layer:** Test infrastructure/environment.  
**Reproduction:** `node node_modules/esbuild/bin/esbuild --version` produced the same platform mismatch.  
**Confirmed root cause:** The existing `node_modules` installation contained `@esbuild/win32-x64`; this workspace runs Linux. `package-lock.json` already specifies the matching `@esbuild/linux-x64` package at esbuild version `0.25.12`.  
**Resolution:** Installed only the matching optional binary locally with `npm install --no-save --package-lock=false --ignore-scripts @esbuild/linux-x64@0.25.12`. No dependency manifest or lockfile change was made by that command. The focused test and full suite then passed. This was an environment repair, not an application-code workaround.

The package-install summary also reported 12 dependency advisory notices (2 moderate, 7 high, 3 critical). Their package-level details were not investigated as part of this focused task, so this report does not attribute those notices to the authorization changes or claim that they are fixed.

### Initial formatting/diff check

The first `git diff --check` reported `trailing whitespace` on changed lines throughout `package.json` and `src/lib/session.ts`. The complete output contained 145 repeated per-line notices; inspection confirmed the files had CRLF line endings, so Git interpreted the carriage return as trailing whitespace. Converting those two task-touched text files to LF resolved the check. No code content was changed by that normalization.

## 10. Security limitations and unresolved decisions

- The tests are unit-level only. Real Auth.js session verification, database revocation, route responses, and server-action behavior still warrant integration tests.
- No HTTP adapter maps `AccessError` to an HTTP status in these helpers; existing server action and API callers continue to handle it under their current conventions. This task did not introduce a global error handler.
- Existing concerns recorded in Task 04 remain out of scope and unfixed: the OAuth staff restriction has a null-password edge case, and the shared dashboard layout queries aggregate counts without its own staff check (runtime disclosure remains unverified).
- Whether the product requires at least one Super Admin remains undecided. These helpers do not impose a cardinality invariant.
- Reports 02 and 03 were absent and were not reconstructed.

## 11. Database schemas and migrations

**No Prisma schema or migration files were changed.** No database commands, destructive operations, or user/account role changes were performed.

## 12. Unrelated files and existing worktree changes

The task changed only:

- `src/lib/session.ts`
- `src/lib/session.test.ts`
- `package.json`
- `copilot-specs/reports/05-authorization-helpers.md`

The worktree already had many unrelated modified files before this task, including `package-lock.json`. Those pre-existing changes were preserved. The local esbuild binary installation was performed with `--no-save --package-lock=false`; it did not intentionally change tracked dependency files.
