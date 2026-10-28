# Dashboard Home Baseline

## Repository and workspace state
- Inspected on 2026-10-28 before implementing the dashboard update.
- The repository has extensive pre-existing modifications across application, configuration, Prisma, reports, and tests. The dashboard work is limited to the authenticated user dashboard and its directly related navigation/styles unless verification requires another fix.
- `.next` was present before implementation; it was not deleted or reset.
- The working tree already contained changes in `src/app/me/page.tsx`, `src/app/me/header.tsx`, and `src/app/globals.css`.

## Baseline route
- Authenticated ordinary-user route: `/me` in `src/app/me/page.tsx`.
- Shared page header: `src/app/me/header.tsx`.
- Profile/social/WhatsApp management: `/me/profile` in `src/app/me/profile/page.tsx`.
- Public advert destination: `/` and existing `#adverts` / advert ID anchors.
- Staff routes remain separate under `/admin`; ordinary users may see the Admin link only when staff authorization is present.

## Existing data capabilities
- Subscriptions, subscriber status, user social handles, active sessions, activity, listed adverts, delivery records, published post targets, and social delivery records are available through Prisma/server services.
- The app is not a third-party advertising analytics platform in this repository; no reliable reach, engagement, click, conversion, trend, or live platform health metrics exist for the user dashboard.
- User account records are application sign-in/social login accounts, not verified published-account connections. They are not represented as connected publishing accounts.
- Live Meta/X/TikTok account publishing remains environment-dependent and unverified.

## Baseline reproduction
- `npm run typecheck` passed.
- `npm test` passed before implementation.
- `npm run build` passed before implementation and generated the expected `/me`, `/me/profile`, `/admin/adverts`, and `/accounts` routes. The previously reported `PageNotFoundError` page-data failures, missing `routes-manifest`, and `_document.js` module error were not reproduced in the observed build.
- Remaining build warnings concern BullMQ child processors and Auth.js Web Compression APIs; they did not prevent the build from completing.

## Baseline limitations
- There is no dedicated activity index page, analytics page, automation workflow backend, calendar route, or campaign analytics module for ordinary users.
- No data is fabricated for unavailable integration, performance, campaign, or automation fields.
- Scheduling previews are limited to real future `sendAt` values on listed adverts.
