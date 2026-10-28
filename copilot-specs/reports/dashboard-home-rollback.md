# Dashboard Home Rollback

## Scope
This rollback removes the dashboard implementation only. It does not revert the user's pre-existing repository changes, authentication, Prisma schema, profile route, widgets, header, global styles, or generated build output.

## Files changed by this work
- `src/app/me/page.tsx`
- `copilot-specs/reports/dashboard-home-baseline.md`
- `copilot-specs/reports/dashboard-home-implementation.md`
- `copilot-specs/reports/dashboard-home-rollback.md`

The baseline report records repository state; it should normally be retained for audit purposes. If the repository does not already have a prior version of `src/app/me/page.tsx`, restore it from source control rather than manufacturing an alternate dashboard.

## Safe rollback
1. Stop the production server if this implementation is being served: `kill 9304` or use the process ID reported by `ps -eo pid,cmd`.
2. Restore the dashboard file from the repository parent revision:
   `git checkout <previous-commit> -- src/app/me/page.tsx`
3. Remove the implementation and rollback report only if they are not needed:
   `rm copilot-specs/reports/dashboard-home-implementation.md copilot-specs/reports/dashboard-home-rollback.md`
4. Do not delete `.next`; keep the existing artifact directory and rebuild only when the previous dashboard source is ready.
5. Run `npm run typecheck` and `npm test` before rebuilding.
6. Run `npm run build`, then start `npm run start -- -p <port>` and verify `/me` access control.

## Recovery if the build remains stale
A `.next` directory can mix old and new compilation output if the source is restored while a build or server is running. Stop Next.js processes, rebuild once, and start only that newly completed build. Do not use `rm -rf` as a routine rollback because it destroys cache and generated evidence. If a clean artifact check is required, preserve the old directory under `/tmp` before rebuilding.

## Do not restore
- Existing `/me/header.tsx` styling and navigation.
- Existing `/me/widgets.tsx` subscription, WhatsApp, or session controls.
- Existing profile handles in `/me/profile/page.tsx`.
- Existing Prisma schema or migration history.
- Pre-existing changes documented in the baseline report.
