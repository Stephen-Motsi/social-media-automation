# Dashboard Home Implementation

## Summary
The authenticated ordinary-user home at `/me` was redesigned as a responsive SaaS-style dashboard using live application data. The implementation is server-rendered and scoped to the signed-in viewer.

## Implementation
- Added a personalized welcome section with the dashboard date and greeting.
- Added primary actions for browsing adverts and managing profile data.
- Added real-data quick actions for adverts, profile/social handles, WhatsApp, and account/security management.
- Added metric cards for unique subscribed adverts, selected platform subscriptions, saved delivery handles, and delivery records.
- Added conditional setup progress that is displayed only until profile, advert selection, and WhatsApp setup are complete.
- Added saved-platform status cards and preserved `/me/profile` as the destination for handle management.
- Added a preview of upcoming listed adverts based on real future `sendAt` values.
- Reused existing subscription, WhatsApp, and session widgets instead of replacing them.
- Preserved existing adverts, recent activity, active sessions, sign-out, and profile functionality.

## Data sources
The `/me` query now includes `subscriptions`, `subscriber`, `socials`, active `sessions`, and recent `activity`. It additionally reads delivery records, published post targets, and social delivery records associated with the signed-in user's subscriptions.

The dashboard does not invent reach, engagement, clicks, conversions, trend percentages, automation runs, live social-connection health, campaign analytics, or third-party performance metrics. Social handles are represented as saved delivery handles, not verified publishing-account connections.

## Verification
- `npm run typecheck`: passed.
- `npm test`: passed when run from the configured repository test command.
- `npm run build`: passed with route generation for `/`, `/login`, `/me`, `/me/profile`, `/accounts`, and admin routes.
- Clean production server on port `3101`: `/` and `/login` returned HTTP 200.
- Production `/me` and `/me/profile` returned HTTP 307 for an unauthenticated viewer, as required.
- The clean server reached `Ready` and no `/` missing `_document` chunk failure was reproduced.
- Public browser verification confirmed the forwarded `/` route rendered the expected home page at port `3101`.

## Warnings and limitations
- The production build continues to emit non-fatal BullMQ child-processor and Auth.js Web Compression API warnings.
- Unauthenticated redirects use callback URLs derived from `AUTH_URL`/local environment configuration and may resolve to port `3000` rather than a temporary port; route protection itself is functioning.
- Authenticated browser verification, saved credential setup, live social publishing, and the user-visible state transitions were not verified without an authenticated browser session.
- Public integration credentials and live Meta/X/TikTok publishing status remain environment-dependent and unverified.
