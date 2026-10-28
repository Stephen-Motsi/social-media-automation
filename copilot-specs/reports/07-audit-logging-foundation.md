# Task 07 — Auditable Administrative Actions

## Summary

Added a reusable server-side audit runner for the existing Super Admin role and session-management actions. It obtains the actor from the trusted `requireSuperAdmin()` authentication context, restricts audit event metadata to a small allowlist, and persists the mutation and its audit row in the same Prisma transaction. A failed audit write propagates as a failure so the transaction can roll back the mutation.

The implementation does not add a role, permission model, authentication flow, schema change, or migration. It is intentionally limited to the three administrative actions in `src/app/(dashboard)/admin/actions.ts`. Other existing activity-log paths retain their existing behavior.

## Existing authorization and audit architecture

- `src/lib/session.ts` exposes `requireSuperAdmin()`, which validates the viewer obtained from the server-side Auth.js context before allowing a privileged operation. The actor is obtained before the audit transaction begins.
- `ActivityLog` already stores an action, JSON detail, target user ID (`userId`), optional actor ID, IP address, and timestamp. The existing model and its constraints were not changed.
- Existing activity logging also uses `logActivity()` and some direct `activityLog.create()` calls. Those general-purpose call sites are unchanged by this task.
- Reports `02-requirements-checklist.md` and `03-baseline-health.md` were not available during the prior review. This implementation therefore follows the existing application behavior and available reports rather than treating those missing reports as approved requirements.

## Implemented behavior

### `src/lib/audit-core.ts`

`createAdminAuditRunner()` is a testable, server-independent core. Its dependencies supply a trusted actor, request IP, transaction boundary, and transaction-scoped audit writer. It:

- Calls the trusted actor provider before starting a transaction.
- Runs the requested operation and any corresponding audit write inside the provided transaction.
- Adds the actor ID and IP from server-side dependencies; neither is accepted from the operation's event data.
- Validates the action against the operation's requested action.
- Accepts only these event details:
  - `ROLE_CHANGE`: exactly `{ from, to }`, with known role values and a destination of `USER` or `ADMIN`.
  - `SESSION_REVOKED`: `null`.
  - `SESSIONS_REVOKED`: exactly `{ count }`, where count is a non-negative safe integer.
- Rejects unexpected keys or malformed metadata with a generic error.
- Propagates operation and audit persistence errors without turning them into success-shaped results.

### `src/lib/session.ts`

`withAdminAudit` binds the generic runner to `requireSuperAdmin()`, the existing `clientIp()` helper, and `prisma.$transaction()`. Audit rows are created using the transaction client. JSON null uses Prisma's `JsonNull` sentinel. The generic runner and its public types are re-exported for the focused test module.

### `src/app/(dashboard)/admin/actions.ts`

- `signOutEverywhere()` selects the target user and revokes active sessions in the transaction; it records `SESSIONS_REVOKED` only when at least one session was revoked.
- `revokeUserSession()` loads the session and target user, conditionally revokes it in the transaction, and records `SESSION_REVOKED` only when the update changed a row.
- `setRole()` obtains the actor from the runner, blocks self-role changes and changes to a Super Admin, and writes a `ROLE_CHANGE` audit row only when the role changes.
- Not-found, already-revoked, no-op, and rejected operations do not write an audit event.
- Page revalidation remains outside the transaction and occurs only for successful results.

## Tests and verification

### Added tests

`src/lib/audit.test.ts` exercises the audit runner with a fake transaction dependency. It covers successful recording, server-derived actor/IP, authorization rejection before transaction entry, failed mutations, extra/sensitive metadata rejection, session revocation counts, and propagation of audit-write failures. These are unit-level tests; they do not connect to a real database and do not independently prove database rollback behavior.

### Exact commands and results

- `npm exec tsx -- src/lib/audit.test.ts`
  - Initial run: all assertions printed PASS, but the process exited with a Prisma engine initialization error because the generated client targeted Windows rather than Linux (`debian-openssl-3.0.x`).
    - Diagnosis: test infrastructure / generated Prisma runtime mismatch. The test imported the Prisma-backed session module; the error itself confirmed the client expected the Windows engine while the runtime was Linux. This does not establish that importing the session module alone is sufficient to trigger an engine load.
    - Fix: the runner was isolated in `src/lib/audit-core.ts`, and the focused test now imports that pure module directly, keeping the unit test independent of the database runtime.
  - Rerun: passed, exit code 0.
- `npm run typecheck`
  - Initial run after the action integration: failed because `AdminState` includes `undefined`, so TypeScript reported `result` as possibly undefined in three post-transaction checks. The action return inference also needed an explicit result type.
  - Fix: supplied `AdminState` as the runner's result type and guarded the success/message checks with optional chaining.
  - Rerun: passed, exit code 0.
- `npm test`
  - Passed, exit code 0, including the existing configured tests, `src/lib/session.test.ts`, and the new audit tests.
- `git diff --check -- src/lib/session.ts src/app/'(dashboard)'/admin/actions.ts src/lib/audit-core.ts src/lib/audit.test.ts`
  - Reported trailing-whitespace notices throughout the modified admin actions file because that pre-existing file uses CRLF line endings. The worktree already contains broad unrelated modifications, including in this file. No line-ending normalization was performed.

## Failures and diagnosis record

1. **Prisma client engine error**
   - Layer: test infrastructure / module initialization.
   - Original output: `PrismaClientInitializationError: Prisma Client could not locate the Query Engine for runtime "debian-openssl-3.0.x". This happened because Prisma Client was generated for "windows"...`
   - Root cause: the error confirmed a generated-client/runtime platform mismatch (Windows-generated client versus Linux `debian-openssl-3.0.x`). The test's import of a Prisma-backed module coupled the unit test to that runtime; this alone was not proven to be the engine mismatch's only trigger.
   - Resolution and verification: moved the generic runner to `src/lib/audit-core.ts`; the focused test now avoids the database runtime and passed. The full `npm test`, which includes the existing session helper tests, also passed. No Prisma generation or dependency-manifest change was made.
2. **TypeScript result narrowing**
   - Layer: type-check/build.
   - Original diagnostics: `src/app/(dashboard)/admin/actions.ts` reported TS18048, `'result' is possibly 'undefined'`, at the three checks following the audited role/session operations. Earlier inference also required specifying the result type for the generic runner.
   - Root cause: the declared action result type permits `undefined`; the new wrapper's generic result type needed to be explicit.
   - Resolution and verification: explicitly parameterized the runner with `AdminState`, used optional checks, and reran `npm run typecheck` successfully.
3. **Whitespace check**
   - Layer: source formatting / pre-existing worktree line endings.
   - Result: `git diff --check` reports CRLF lines in the modified admin actions file as trailing whitespace.
   - Resolution: no normalization was performed to avoid rewriting the file's line endings. This does not affect the successful typecheck or tests.

## Security limitations and unresolved decisions

- Atomic mutation-plus-audit behavior is wired only for the three Super Admin role/session actions above. General activity-log calls elsewhere remain outside this contract; several existing call sites catch and ignore logging errors.
- Unit tests use a fake transaction implementation. A real PostgreSQL integration test was not run, so rollback on audit-insert failure is supported by the Prisma transaction structure but was not verified against a database in this task.
- The generic runner restricts audit event type and metadata shape, but it does not itself control which server-side callers may invoke it. The production binding is server-side and obtains its actor through `requireSuperAdmin()`. Callers still must not expose this helper to browser code.
- The existing `ActivityLog` schema has no new integrity constraints or retention/audit immutability guarantees. Adding such guarantees would require separate requirements and likely schema/design review.
- The pre-existing `clientIp()` implementation accepts forwarded-IP headers. IP is supplemental audit metadata, not an identity or authorization input; its trust configuration was not changed or independently verified.
- The generated Prisma client/runtime mismatch was observed on the initial focused run. After decoupling the focused test and subsequent full-suite run, both passed; this task did not regenerate Prisma Client or alter dependency manifests.
- No migration status, live database connectivity, or production data was tested.

## Database and scope confirmation

- No Prisma schema or migration file was changed by Task 07.
- No database connection, migration command, data mutation, or account/role change was performed.
- Task-scoped implementation/test files: `src/lib/audit-core.ts`, `src/lib/audit.test.ts`, `src/lib/session.ts`, `src/app/(dashboard)/admin/actions.ts`, and `package.json` (the configured test command was extended to include the audit test; the session helper test was already configured).
- Required report: `copilot-specs/reports/07-audit-logging-foundation.md`.
- The worktree contained many pre-existing unrelated modifications. They were not reverted or normalized. Apart from the required report and the scoped test-script update, no unrelated file was created for Task 07.

## Recommended follow-up

1. Review the audit event contract and confirm whether other sensitive admin operations should use it in a later, separately scoped task.
2. Add a database-backed integration test for transaction rollback on audit-write failure when an approved test database is available.
3. Decide separately whether audit immutability, retention, actor/target foreign-key behavior, and forwarded-IP trust need explicit requirements or schema/configuration changes.
