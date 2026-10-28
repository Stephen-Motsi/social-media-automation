# Admin and Super Admin Baseline

## Repository state
- Inspected on 2026-10-28 before implementation.
- `git status --short` was clean: no pre-existing modified or untracked files were present at audit time.

## Architecture and permissions
- Application uses Next.js App Router and Prisma/PostgreSQL.
- Roles are `USER`, `ADMIN`, and `SUPER_ADMIN`.
- Staff routes are guarded by `pageViewer("staff")`, staff APIs use `requireStaff()`, and Super Admin routes/actions use `pageViewer("super")` or `requireSuperAdmin()`.
- Ordinary `/me` routes are separate from the staff dashboard under routes such as `/admin`, `/create`, `/channels`, `/audience`, `/approvals`, and `/posts`.
- `UserSession` and database-backed session checks are trusted server-side; hiding navigation is not authorization.

## User-side feature inventory
- Sign-in and profile management: `/login`, `/me`, `/me/profile`.
- Advert subscriptions and WhatsApp/social handles: `/me`, `/me/profile`, `/subscribe`, `/subscribe/manage/[token]`.
- Delivery, sessions, and activity: backed by subscriptions, `Delivery`, `SocialDelivery`, `UserSession`, and `ActivityLog`.
- Public advert discovery: `/`.

## Administrative feature inventory
- Admin overview and channels: `/admin`, `/channels`, `/accounts`.
- Advert creation and listing: `/create`, `/admin/adverts`.
- Scheduling, channels, audience, approvals, posts: `/posts`, `/channels`, `/audience`, `/approvals`.
- User status and role administration: `/admin/users`, `/admin/roles`.
- Super Admin platform overview and audit visibility: `/admin/super-admin`, `/admin/logs`, `/admin/notifications`.

## Existing advert creation
- Both Admin and Super Admin use the shared staff dashboard `/create` and shared `Studio` implementation.
- Server actions require staff authorization and create platform-specific `MediaAsset` records.
- Platform variants are supported through `platformMedia` JSON and existing `PostTarget` records.
- OpenAI integration exists in `src/lib/ai/openai.ts` and advert-generation logic exists in `src/lib/advert-images.ts`.
- OpenAI credentials were not verified live.
- Image generation currently requests AI backgrounds but does not maintain a dedicated deterministic text-composition layer.
- Sharp is not declared as a direct dependency.

## Connected-account data
- Verified connected identity is stored in `SocialAccount`: provider platform, external ID, display name, optional platform handle, profile URL, and expiry metadata.
- Secrets are stored encrypted and are not suitable for client rendering.
- Existing `/create` loads social accounts, but generation currently does not provide account-scoped variant selection or guaranteed selected handle composition.

## Historical Next.js error diagnosis
- A production build was run before implementation as the baseline check.
- It passed and generated routes including `/admin/adverts` and `/create`.
- No reproduction of `MODULE_NOT_FOUND` for `.next/server/pages/_document.js`, missing `.next/routes-manifest.json`, or page-data collection failure for `/admin/adverts` was observed in the baseline build log.
- This remains an environment/artifact concern; a clean rebuild should be repeated after implementation before conclusions about regressions.

## Known limitations
- Live Meta/X/TikTok publishing is unverified.
- OpenAI image generation is blocked without a valid `OPENAI_API_KEY`.
- Image storage is PostgreSQL `MediaAsset`; no object-store pipeline is implemented.
- Worker and Redis availability are required for scheduled delivery.
- Billing, subscription plans, quota management, and user analytics are not implemented as complete product features.
