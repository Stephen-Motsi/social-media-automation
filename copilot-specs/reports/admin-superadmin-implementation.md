# Admin and Super Admin Implementation

## Audit outcome
- The repository was clean at the start of implementation.
- The admin and super-admin surfaces share the staff dashboard shell and server-side role checks.
- `/create` is already the shared advert workflow for both Admin and Super Admin.
- OpenAI generation existed, but image text depended on the model and no deterministic text composition was present.
- Connected account identities exist in `SocialAccount`; the draft workflow did not previously pass account identity into generation.
- The production build passed before implementation, including `/admin/adverts`; the historical `_document`, routes-manifest, and page-data failures did not reproduce.

## Implemented workflow
- Added headline, offer, supporting copy, CTA, connected-account, and manual-brand-handle controls to the shared `/create` wizard.
- Added a Sharp-based hybrid compositor that:
  1. uses OpenAI for the visual background when configured;
  2. resizes the background for platform placement;
  3. deterministically renders headline, offer, supporting copy, CTA, and account handle;
  4. outputs platform-specific variants.
- Generation actions validate the selected account against the target platform and require a usable verified handle.
- Manual handles are accepted only as explicitly marked brand identities and are format-validated.
- Added `Post.creativeBrief` JSON persistence for saved copy and account selections.
- Super Admin overview now includes direct access to the shared Create Advert workflow.
- Fixed draft ownership checks in the shared edit/load/save path so a staff user cannot update or load another user's draft by ID.

## Provider and configuration
- Provider: existing OpenAI integration.
- Image generation remains blocked honestly when `OPENAI_API_KEY` is missing.
- Missing credentials return the existing configuration error and do not create fake generated output.
- Key configuration uses server-side environment variables only.

## Database and dependency changes
- Added migration `20261028095403_advert_creative_brief` adding `Post.creativeBrief` JSONB.
- Migration status confirmed the migration was created but not yet applied to the configured PostgreSQL database.
- Added direct dependency `sharp@0.34.5` for server-side composition and platform output validation.

## Verification
- `npm run typecheck`: passed.
- `npm test`: passed, including the new platform compositor dimensions test.
- `npx prisma validate`: passed.
- `npm run build`: passed; `/create`, `/admin/adverts`, `/admin`, `/admin/super-admin`, and existing routes were generated.
- Non-fatal build warnings remain for BullMQ dynamic dependencies and Auth.js Web Compression APIs.
- Prisma migration status was checked: the new migration is pending deployment.

## Not live-verified
- Live OpenAI image generation and billable provider behavior.
- Live connected social accounts or account handle retrieval.
- Live Meta/X/TikTok publishing.
- Authenticated Admin/Super Admin browser flows.
- Multi-device browser rendering of the updated wizard.

## Required follow-up
1. Deploy or apply the creative-brief migration.
2. Set `OPENAI_API_KEY` and the approved OpenAI image-model environment settings before live generation.
3. Configure social accounts and worker infrastructure for scheduled publishing.
4. Manually verify authenticated role routes and variant previews.
5. Add provider usage/quota accounting if platform-wide AI billing oversight is required.
