# Admin and Super Admin Rollback

## Changed files
- `prisma/schema.prisma`
- `prisma/migrations/20261028095403_advert_creative_brief/migration.sql`
- `package.json`
- `package-lock.json`
- `src/app/(dashboard)/admin/super-admin/page.tsx`
- `src/app/(dashboard)/create/actions.ts`
- `src/app/(dashboard)/create/page.tsx`
- `src/app/(dashboard)/create/studio.tsx`
- `src/lib/advert-images.ts`
- `src/lib/advert-compositor.ts`
- `src/lib/advert-compositor.test.ts`
- `copilot-specs/reports/admin-superadmin-baseline.md`
- `copilot-specs/reports/admin-superadmin-feature-matrix.md`
- `copilot-specs/reports/admin-superadmin-implementation.md`
- This rollback report

## Database rollback
The migration only adds `Post.creativeBrief` JSONB. It has not been applied to the configured database during this implementation.

Before removing the migration, stop the application and run:

```sql
ALTER TABLE "Post" DROP COLUMN IF EXISTS "creativeBrief";
```

Then remove the migration directory only if it will not be retained as audit history. Do not edit already-deployed migration history; roll forward with a corrective migration when migration history is shared.

## Application rollback
1. Stop running Next.js and worker processes.
2. Restore only the implementation source files listed above using their pre-change versions from source control or an isolated branch.
3. Remove `sharp` with `npm uninstall sharp` or restore the manifest and lockfile versions from the parent commit.
4. Remove the migration directory if it was never deployed.
5. Regenerate Prisma client with `npx prisma generate`.
6. Run `npm run typecheck` and `npm test`.
7. Run `npm run build` once, then start only that build.

## Preserve existing work
- Do not revert unrelated dashboard, landing-page, profile, authentication, schema, migration, or user-session changes.
- Preserve existing `/create`, `/admin/adverts`, OpenAI prompt, policy-review, scheduling, audience, and publishing behavior.
- Existing generated media and published drafts remain in PostgreSQL; rollback does not delete `MediaAsset` rows.

## Next build cleanup
Do not run new builds or servers while an old production server is using `.next`. Stop the process, rebuild once, and start that completed artifact.
