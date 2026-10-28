# Task 04 — Authentication and Role Map

**Investigation date:** 2026-10-27  
**Scope:** Read-only inspection of the current working-tree implementation. No tests or application commands were run.

## 1. Executive summary

The application uses Auth.js / NextAuth v5 (`next-auth` 5.0.0-beta.29) with a JWT-strategy cookie and a custom Prisma-backed `UserSession` record. Sign-in is implemented through email/password credentials and optional Google and Facebook OAuth. A development-only mock OAuth provider is also conditionally supported.

The cookie is not the final authority for server-side access: Auth.js session reads in the full server configuration look up the session record and current user in PostgreSQL, reject revoked/expired sessions and disabled users, and populate the current database role. Middleware uses a separate edge-safe configuration and makes only a coarse signed-in/public-route decision. Page, server-action, and protected API boundaries generally perform their own server-side role checks.

Roles are a Prisma enum: `USER`, `ADMIN`, and `SUPER_ADMIN`. The application has no separate permissions table or granular permission system. Super-admin-only server actions manage promotions/demotions between `USER` and `ADMIN` and revoke other users’ sessions. The action does not permit changing a `SUPER_ADMIN` role.

**Confirmed concerns:** (1) the staff-only-password OAuth restriction is conditional on a non-null `passwordHash`, so a staff record without a password hash can proceed through the social sign-in/linking path; (2) privileged aggregate counts are queried in the shared dashboard layout without an explicit staff check, although whether a non-staff user can observe them before the guarded child page redirects is not established statically; and (3) the CLI user-provisioning and migration role changes are not represented in the application activity log. Public self-signup is also implemented despite an outdated schema comment stating that users are created by admins.

No direct role-escalation route for an ordinary user was confirmed in the inspected application paths. The actual configured OAuth providers, production cookie settings, live user/role state, and runtime behavior of the dashboard-layout redirect path were not verified.

## 2. Authentication architecture

- `src/auth.ts` constructs the full Auth.js configuration and exports `handlers`, `auth`, `signIn`, and `signOut`. Its providers are Credentials, conditionally Google and Facebook, and a mock OAuth provider only when `MOCK_OAUTH_URL` is set outside production. Provider activation at runtime depends on environment variables; their values were not inspected. See [`src/auth.ts`](../../src/auth.ts#L1-L5), [`src/auth.ts`](../../src/auth.ts#L34-L76), and [`package.json`](../../package.json#L1-L30).
- `src/auth.config.ts` is the edge-safe shared configuration. It selects JWT sessions with a 30-day `maxAge`, declares `/login` as the sign-in page, identifies public URL patterns, and supplies the `authorized` callback. Its JWT role is used to select a post-sign-in landing URL; the callback does not use it as the final staff-access decision. See [`src/auth.config.ts`](../../src/auth.config.ts#L7-L37).
- `src/middleware.ts` wraps that edge-safe configuration and matches application paths other than Next static/image assets and the favicon. The full Auth.js route handlers are exposed at `/api/auth/[...nextauth]`. See [`src/middleware.ts`](../../src/middleware.ts#L1-L9) and [`src/app/api/auth/[...nextauth]/route.ts`](../../src/app/api/auth/%5B...nextauth%5D/route.ts#L1-L3).
- The full configuration uses server-side Prisma and bcrypt; the middleware configuration is intentionally database-free. The full `auth()` callback validates database session state on server-side session reads (section 4).

## 3. Login and logout flow

### Login

- Email/password sign-in is implemented by the Credentials provider in `src/auth.ts`. It validates email/password input with Zod, lowercases the email for lookup, rejects missing password hashes and disabled accounts, and compares the submitted password with `bcrypt.compare`. See [`src/auth.ts`](../../src/auth.ts#L12-L14) and [`src/auth.ts`](../../src/auth.ts#L38-L45).
- The login server action in `src/app/login/actions.ts` calls `signIn("credentials", ...)`; Auth.js errors are converted to a user-facing invalid-credentials message, while successful redirect exceptions are rethrown. It uses a same-site callback path check and picks a default destination based on the looked-up role. See [`src/app/login/actions.ts`](../../src/app/login/actions.ts#L11-L34).
- OAuth login is initiated by the login page’s provider buttons and `socialLogin` server action. Google and Facebook providers only appear when their relevant environment keys exist; the mock provider is limited to non-production. See [`src/app/login/page.tsx`](../../src/app/login/page.tsx#L18-L31), [`src/app/login/page.tsx`](../../src/app/login/page.tsx#L62-L85), and [`src/app/login/actions.ts`](../../src/app/login/actions.ts#L36-L38).
- In the OAuth `signIn` callback, an existing linked provider account is used only if its user is not disabled. For unlinked identities, the callback looks up by email, disallows certain staff accounts with an existing password hash, handles verified-email/password-account linking, and otherwise creates a `USER` record and links the provider account. See [`src/auth.ts`](../../src/auth.ts#L87-L120).
- A public signup action also creates email/password accounts, hashes the password with bcrypt cost 12, sets the role explicitly to `USER`, logs `SIGN_UP`, and signs the account in. This is self-registration; it conflicts with the schema comment that users are created by an admin. See [`src/app/login/actions.ts`](../../src/app/login/actions.ts#L42-L73) and [`prisma/schema.prisma`](../../prisma/schema.prisma#L64-L74).

### Logout

- The dashboard shell receives a server action that calls `signOut({ redirectTo: "/login" })`. See [`src/app/(dashboard)/layout.tsx`](../../src/app/%28dashboard%29/layout.tsx#L18-L28).
- Auth.js’s `signOut` event revokes the associated `UserSession` row and, when a session was revoked, records a `SIGN_OUT` activity event. See [`src/auth.ts`](../../src/auth.ts#L175-L184).
- Users can also revoke their own sessions from `src/app/me/actions.ts`; each update is scoped to the current viewer’s user ID. See [`src/app/me/actions.ts`](../../src/app/me/actions.ts#L97-L120).

## 4. Session and identity management

- `User` records are identified by a unique email and ID. OAuth identities are stored separately in `Account`, uniquely keyed by `(provider, providerAccountId)`. See [`prisma/schema.prisma`](../../prisma/schema.prisma#L66-L98) and [`prisma/schema.prisma`](../../prisma/schema.prisma#L407-L416).
- On successful authentication, the full `jwt` callback creates a `UserSession` row with provider, request IP/user agent, and a fixed expiration 30 days after creation. Its ID (`sid`) and the user identity/role are put into the Auth.js JWT. See [`src/auth.ts`](../../src/auth.ts#L123-L151).
- On each full server-side session callback, the app fetches the `UserSession` and related user, rejects absent/revoked/expired records, disabled users, or a token/user mismatch, and copies identity plus current role into the session. This means role changes are picked up on a subsequent server-side session read rather than relying on the JWT’s role copy. `lastSeenAt` is touched at most once per minute; the database `expiresAt` is not extended by that touch. See [`src/auth.ts`](../../src/auth.ts#L154-L172) and [`prisma/schema.prisma`](../../prisma/schema.prisma#L418-L433).
- The edge middleware does not perform that database lookup. It allows protected paths only when its Auth.js context has a user and redirects signed-out requests through the configured `/login` page. The full server checks remain necessary because the middleware uses the cookie context and cannot see revocations/current database roles. See [`src/auth.config.ts`](../../src/auth.config.ts#L15-L29) and [`src/lib/session.ts`](../../src/lib/session.ts#L14-L35).
- A stale but signed cookie can still pass the middleware’s coarse check; `pageViewer` detects that `auth()` returned no viewer and, when it finds an Auth.js session cookie, sends the browser to `/login?expired=1`. The middleware explicitly permits that login URL to avoid a redirect loop. See [`src/lib/session.ts`](../../src/lib/session.ts#L21-L35) and [`src/auth.config.ts`](../../src/auth.config.ts#L22-L24).
- The schema stores a nullable `passwordHash`; implementation uses bcryptjs. No password-reset flow was identified in the inspected routes. OAuth uses Auth.js provider callbacks; no Auth.js Prisma adapter or built-in database session strategy is configured. The app’s own `Account` and `UserSession` tables are managed by callbacks.

## 5. Existing user roles and where they are defined

`Role` is defined in Prisma as `USER`, `ADMIN`, `SUPER_ADMIN`, and `User.role` defaults to `USER`. There are no separate role-permission tables or permission records. See [`prisma/schema.prisma`](../../prisma/schema.prisma#L12-L16) and [`prisma/schema.prisma`](../../prisma/schema.prisma#L66-L75).

- `USER`: ordinary account; can access user pages/actions guarded by `pageViewer("user")` or `requireViewer()`.
- `ADMIN`: staff; `isStaff` treats `ADMIN` and `SUPER_ADMIN` as staff. Staff pages/actions use `pageViewer("staff")` or `requireStaff()`.
- `SUPER_ADMIN`: privileged staff; user/role/session-management pages and actions use exact `SUPER_ADMIN` checks (`pageViewer("super")` / `requireSuperAdmin()`).

Role values are stored in the database. A copy is also included in the JWT/session for navigation, but full server session reads use the current database role. `src/components/dashboard-shell.tsx` hides the administration navigation unless the passed role is `SUPER_ADMIN`; this is presentation, not enforcement. See [`src/lib/session.ts`](../../src/lib/session.ts#L10-L18), [`src/auth.ts`](../../src/auth.ts#L146-L170), and [`src/components/dashboard-shell.tsx`](../../src/components/dashboard-shell.tsx#L52-L60).

## 6. Authorization and permission-checking mechanisms

- `src/lib/session.ts` centralizes `getViewer`, `pageViewer`, `requireViewer`, `requireStaff`, and `requireSuperAdmin`. Page checks redirect to an appropriate page; action/API helpers throw `AccessError` for missing or insufficient access. The viewer comes from the full database-checked Auth.js session. See [`src/lib/session.ts`](../../src/lib/session.ts#L10-L50).
- `isStaff` is an explicit role predicate (`ADMIN` or `SUPER_ADMIN`); super-admin checks compare exactly with `SUPER_ADMIN`. There are no fine-grained permission capabilities.
- `src/app/(dashboard)/admin/actions.ts` protects ordinary staff operations with `requireStaff()` and session/role management with `requireSuperAdmin()`. Its `setRole` action accepts only `USER` or `ADMIN`, disallows changing the actor’s own role, and refuses to change a target already marked `SUPER_ADMIN`. Role changes and session revocations are recorded with actor information in the activity log. See [`src/app/(dashboard)/admin/actions.ts`](../../src/app/%28dashboard%29/admin/actions.ts#L69-L105).
- Ordinary public signup assigns only `USER`. The user profile actions update profile/subscription/session data for the current viewer and do not accept role changes. The administrative server action is the in-app route for promoting/demoting users.
- Operational provisioning is separate from application authorization: `scripts/create-user.ts` accepts CLI flags to create `ADMIN` or `SUPER_ADMIN` accounts; `prisma/seed.ts` creates a `SUPER_ADMIN` if its configured email does not exist; a migration promotes the oldest existing `ADMIN` to `SUPER_ADMIN`. These are privileged deployment/operator mechanisms, not user-facing role controls. See [`scripts/create-user.ts`](../../scripts/create-user.ts#L1-L30), [`prisma/seed.ts`](../../prisma/seed.ts#L5-L23), and [`prisma/migrations/20261023195907_roles_sessions_advert_subscriptions/migration.sql`](../../prisma/migrations/20261023195907_roles_sessions_advert_subscriptions/migration.sql#L112-L117).

## 7. Protected routes, APIs, server actions, and middleware

- **Middleware:** Public patterns are `/`, `/subscribe/...`, `/login`, `/api/auth/...`, `/api/webhooks/...`, and `/api/media/...`. Other matched requests require a signed-in Auth.js context in middleware; role authorization is deferred to server boundaries. See [`src/auth.config.ts`](../../src/auth.config.ts#L7-L29).
- **Pages:** Dashboard pages for posts, audience, channels, approvals, creation, adverts, notifications, and admin overview call `pageViewer("staff")`. User pages call `pageViewer("user")`. User list, role management, super-admin overview, and audit logs call `pageViewer("super")`. The `/accounts` dashboard page redirects to `/channels`, which then enforces staff access. Examples: [`src/app/(dashboard)/admin/users/page.tsx`](../../src/app/%28dashboard%29/admin/users/page.tsx#L22-L24), [`src/app/(dashboard)/admin/roles/page.tsx`](../../src/app/%28dashboard%29/admin/roles/page.tsx#L14-L16), [`src/app/(dashboard)/admin/logs/page.tsx`](../../src/app/%28dashboard%29/admin/logs/page.tsx#L28-L30), [`src/app/(dashboard)/channels/page.tsx`](../../src/app/%28dashboard%29/channels/page.tsx#L96-L98), and [`src/app/me/page.tsx`](../../src/app/me/page.tsx#L27-L29).
- **Server actions:** `admin/actions.ts`, `admin/notifications/actions.ts`, `approvals/actions.ts`, `audience/actions.ts`, `channels/actions.ts`, `create/actions.ts`, and `posts/actions.ts` use `requireStaff`/`requireSuperAdmin` directly or through local helpers. `me/actions.ts` uses `requireViewer()` and scopes record changes to the current viewer. Login and subscription/manage actions are public flows; manage-token actions authorize by possession of a `manageToken`, not by an authenticated account. Representative references: [`src/app/(dashboard)/approvals/actions.ts`](../../src/app/%28dashboard%29/approvals/actions.ts#L11-L22), [`src/app/(dashboard)/channels/actions.ts`](../../src/app/%28dashboard%29/channels/actions.ts#L24-L28), [`src/app/me/actions.ts`](../../src/app/me/actions.ts#L20-L28), and [`src/app/subscribe/actions.ts`](../../src/app/subscribe/actions.ts#L116-L140).
- **API routes:** Uploads require a current staff viewer and return 403 otherwise (`src/app/api/uploads/route.ts`). Meta, X, and TikTok connect and callback handlers call `auth()` and enforce `isStaff`; callbacks also compare OAuth state cookies. See [`src/app/api/uploads/route.ts`](../../src/app/api/uploads/route.ts#L10-L14), [`src/app/api/meta/connect/route.ts`](../../src/app/api/meta/connect/route.ts#L8-L16), [`src/app/api/meta/callback/route.ts`](../../src/app/api/meta/callback/route.ts#L19-L33), and the corresponding X/TikTok route files.
- **Admin log export:** `GET /admin/logs/export` independently calls `getViewer()` and returns 403 unless the database-checked viewer is `SUPER_ADMIN`. See [`src/app/(dashboard)/admin/logs/export/route.ts`](../../src/app/%28dashboard%29/admin/logs/export/route.ts#L12-L15).
- **Intentionally public APIs:** `GET /api/media/[id]` is documented as public for social-platform image fetching; it returns 404 for missing/blocked media. Meta webhook GET validates the configured verification token; POST verifies the request signature before processing. See [`src/app/api/media/[id]/route.ts`](../../src/app/api/media/%5Bid%5D/route.ts#L3-L13) and [`src/app/api/webhooks/meta/route.ts`](../../src/app/api/webhooks/meta/route.ts#L10-L30).
- **Shared dashboard layout:** `src/app/(dashboard)/layout.tsx` calls `auth()` and queries aggregate campaign, subscriber, and notification counts but has no explicit role guard before those queries. Its child pages generally perform their own access check. The static code confirms the unguarded parent query; whether a non-staff user can observe rendered counts before a child redirect requires runtime verification. See [`src/app/(dashboard)/layout.tsx`](../../src/app/%28dashboard%29/layout.tsx#L5-L28).

## 8. Database models relevant to users, roles, permissions, and sessions

- `User`: ID, unique email, profile fields, nullable `passwordHash`, enum role, disabled timestamp, and relations to identities, sessions, and activity.
- `Account`: external provider identity, unique provider/provider-account-ID pair, linked to `User`.
- `UserSession`: provider, IP, user agent, creation/last-seen/expiry timestamps, revocation timestamp, and user relation.
- `ActivityLog`: action, JSON detail, IP, timestamp, user, and optional actor ID. Its schema comments include sign-in/out, role changes, and session revocations as examples.
- There are no database models for granular permission grants. The `Role` enum on `User` is the role source of truth.

Schema references: [`prisma/schema.prisma`](../../prisma/schema.prisma#L12-L16), [`prisma/schema.prisma`](../../prisma/schema.prisma#L66-L98), [`prisma/schema.prisma`](../../prisma/schema.prisma#L407-L451).

## 9. Existing authentication and authorization tests

The repository’s test files are utility/domain tests: `src/lib/x.test.ts`, `src/lib/schedule.test.ts`, `src/lib/policy/subscriptions.test.ts`, `src/lib/dashboard-series.test.ts`, `src/lib/advert-prompt.test.ts`, `src/lib/audience.test.ts`, `src/lib/policy/review.test.ts`, and `src/lib/handles.test.ts`. No dedicated authentication, login/logout, session revocation/expiry, role enforcement, protected route/API, unauthorized/forbidden, or administrative-action tests were found in the repository test-file search.

`package.json`’s `test` script runs those eight library tests. Tests were not run for this mapping task; no test result is claimed.

## 10. Confirmed security concerns

1. **Staff OAuth restriction has a null-password gap.** The OAuth sign-in callback refuses an unlinked social sign-in for a non-`USER` role only when `existing.passwordHash` is truthy. If a database user has role `ADMIN` or `SUPER_ADMIN` and a null password hash, that condition does not reject the sign-in; the callback can continue to link the provider account to that user. The schema permits a null hash, and the application comment says staff use passwords. The code path is confirmed; whether a real account currently meets those conditions and whether a provider is enabled were not checked. References: [`src/auth.ts`](../../src/auth.ts#L95-L120), [`prisma/schema.prisma`](../../prisma/schema.prisma#L66-L75).
2. **Dashboard parent performs global aggregate reads without an explicit role check.** The layout runs `auth()` and queries global pending-campaign, review-subscriber, and unread-notification counts before child page guards. Static inspection confirms the missing parent role check; actual disclosure to a `USER` depends on Next.js rendering/redirect behavior and must be tested in a controlled runtime. Reference: [`src/app/(dashboard)/layout.tsx`](../../src/app/%28dashboard%29/layout.tsx#L5-L28).
3. **Privilege provisioning is not fully represented in the application audit log.** In-app `setRole` and session-revocation actions call `logActivity`, but the `create-user` script and migration role promotion directly create/change privileged user roles without creating corresponding `ActivityLog` records. Thus the application log does not capture those provisioning paths. References: [`src/app/(dashboard)/admin/actions.ts`](../../src/app/%28dashboard%29/admin/actions.ts#L69-L105), [`scripts/create-user.ts`](../../scripts/create-user.ts#L10-L30), [`prisma/seed.ts`](../../prisma/seed.ts#L12-L23), and [`prisma/migrations/20261023195907_roles_sessions_advert_subscriptions/migration.sql`](../../prisma/migrations/20261023195907_roles_sessions_advert_subscriptions/migration.sql#L112-L117).

No direct client-controlled role escalation or protected administrative endpoint bypass was confirmed by static inspection. This is not a substitute for runtime authorization testing.

## 11. Potential concerns requiring further verification

- Verify in an integration/browser test whether an authenticated `USER` visiting dashboard-group paths can observe the shared layout’s aggregate counts while a child page redirects.
- Verify that the application’s intended staff policy truly requires password-only authentication. If so, test records for both non-null and null `passwordHash` against each enabled OAuth provider; provider activation and current database records were not inspected.
- Verify production Auth.js secret, secure-cookie behavior, trusted host/base URL, and cookie attributes through deployment configuration without exposing values. This read-only task did not inspect `.env.local` or runtime secrets.
- The Prisma schema comment says no user self-signup, but `signup()` is publicly reachable and creates `USER` accounts. Confirm whether self-registration is intended and reconcile documentation/policy.
- No explicit invariant requiring exactly one or at least one `SUPER_ADMIN` was found. The in-app role action refuses all changes to a `SUPER_ADMIN`, but no database constraint or general transactional last-super-admin invariant was found. The seed, migration, and CLI can create/promote privileged users via operator paths.
- `src/app/login/actions.ts` calculates the default landing role before calling `signIn`; this affects navigation only in the inspected code. Confirm the full callback-path and route behavior in a running deployment if redirect correctness is security-sensitive.

## 12. Implications for Super Admin implementation

- Enforce `SUPER_ADMIN` on the server for every page, server action, and API route that exposes or changes privileged data; preserve frontend visibility checks as UX only.
- Use the full database-validated viewer/current database role, not the edge middleware’s JWT role copy or client-submitted role/user fields.
- Protect role changes with server-side actor authorization and target validation; the existing `setRole` action is a relevant pattern but currently limits targets to `USER`/`ADMIN`.
- Decide and explicitly encode whether a minimum-one-super-admin invariant is required. If it is, evaluate concurrent changes and privileged operator/deployment paths, not just the UI action.
- Ensure all privilege-grant/revoke paths—including CLI seeding/provisioning and migrations, if they remain supported—are auditable or explicitly documented as out-of-band.
- Account for session revocation and role staleness. Current full server-side session reads load the current database role, and role changes therefore apply on subsequent server requests; middleware navigation state may still be a stale copy.
- Resolve whether OAuth is allowed for staff, especially for staff records without `passwordHash`, before adding more role-management features.
- Keep current sign-in/sign-out/session semantics stable unless a documented product or security requirement justifies changing them.

## 13. Recommended follow-up work

1. Confirm intended public signup and staff authentication policies with the product owner.
2. Add focused tests for user/staff/super-admin page, action, and API authorization; include forged role parameters, revoked/expired sessions, disabled accounts, and role changes between requests.
3. Reproduce the dashboard-layout aggregate-read scenario with a non-staff account in a controlled test environment.
4. Decide and document the super-admin cardinality invariant, if any, and assess application plus operator/deployment flows against it.
5. Define an audit approach for role provisioning done by CLI, seed, or migration.
6. After requirements are agreed, address the staff OAuth null-password policy gap through a separately reviewed change. No fix was made in this task.

## 14. Files inspected, with paths and relevant symbols

- [`src/auth.ts`](../../src/auth.ts): provider setup; Credentials `authorize`; OAuth `signIn`; `jwt`, `session`, and `signOut` callbacks.
- [`src/auth.config.ts`](../../src/auth.config.ts): public routes, JWT session config, `authorized` callback, staff landing role.
- [`src/middleware.ts`](../../src/middleware.ts): middleware wrapper and matcher.
- [`src/lib/session.ts`](../../src/lib/session.ts): `getViewer`, `pageViewer`, `isStaff`, `requireViewer`, `requireStaff`, `requireSuperAdmin`.
- [`src/types/next-auth.d.ts`](../../src/types/next-auth.d.ts): session user augmentation.
- [`src/app/api/auth/[...nextauth]/route.ts`](../../src/app/api/auth/%5B...nextauth%5D/route.ts): Auth.js handlers.
- [`src/app/login/actions.ts`](../../src/app/login/actions.ts): `login`, `socialLogin`, `signup`, callback URL validation.
- [`src/app/login/page.tsx`](../../src/app/login/page.tsx) and [`src/app/login/login-form.tsx`](../../src/app/login/login-form.tsx): sign-in/signup UI and errors.
- [`src/app/(dashboard)/layout.tsx`](../../src/app/%28dashboard%29/layout.tsx) and [`src/components/dashboard-shell.tsx`](../../src/components/dashboard-shell.tsx): shared layout and role-dependent navigation.
- [`src/app/(dashboard)/admin/actions.ts`](../../src/app/%28dashboard%29/admin/actions.ts): staff and super-admin server actions, role changes, session revocation.
- Dashboard pages/actions: [`src/app/(dashboard)/admin/`](../../src/app/%28dashboard%29/admin), [`src/app/(dashboard)/approvals/`](../../src/app/%28dashboard%29/approvals), [`src/app/(dashboard)/audience/`](../../src/app/%28dashboard%29/audience), [`src/app/(dashboard)/channels/`](../../src/app/%28dashboard%29/channels), [`src/app/(dashboard)/create/`](../../src/app/%28dashboard%29/create), and [`src/app/(dashboard)/posts/`](../../src/app/%28dashboard%29/posts).
- User/account actions and pages: [`src/app/me/actions.ts`](../../src/app/me/actions.ts), [`src/app/me/page.tsx`](../../src/app/me/page.tsx), and [`src/app/me/profile/page.tsx`](../../src/app/me/profile/page.tsx).
- API boundaries: [`src/app/api/uploads/route.ts`](../../src/app/api/uploads/route.ts), [`src/app/api/media/[id]/route.ts`](../../src/app/api/media/%5Bid%5D/route.ts), [`src/app/api/webhooks/meta/route.ts`](../../src/app/api/webhooks/meta/route.ts), Meta/X/TikTok connect and callback route files under [`src/app/api/`](../../src/app/api), and [`src/app/(dashboard)/admin/logs/export/route.ts`](../../src/app/%28dashboard%29/admin/logs/export/route.ts).
- Database and provisioning: [`prisma/schema.prisma`](../../prisma/schema.prisma), [`prisma/seed.ts`](../../prisma/seed.ts), [`scripts/create-user.ts`](../../scripts/create-user.ts), and [`prisma/migrations/20261023195907_roles_sessions_advert_subscriptions/migration.sql`](../../prisma/migrations/20261023195907_roles_sessions_advert_subscriptions/migration.sql).
- Test inventory and runner: [`package.json`](../../package.json) and the `src/lib` test files listed in section 9.

## 15. Limitations and unverified assumptions

- This is a static review of the current working-tree contents; it does not establish what is deployed or what database rows currently exist.
- Runtime provider activation, secrets, cookie settings, live account roles, disabled-account state, and environment values were not inspected. No credentials, tokens, cookies, password hashes, or secret values were accessed or recorded.
- No application, database, or browser tests were run. The dashboard-layout disclosure question and active provider/account combinations remain unverified.
- The worktree already contained extensive changes before this task. Those files were preserved; only the required report was created by this investigation.
