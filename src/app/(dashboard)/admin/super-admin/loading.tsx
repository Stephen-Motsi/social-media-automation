export default function SuperAdminLoading() {
  return (
    <div aria-label="Loading super-admin dashboard" aria-busy="true" className="space-y-6">
      <div className="animate-pulse space-y-3">
        <div className="h-4 w-36 rounded bg-ink/10 dark:bg-white/10" />
        <div className="h-9 w-72 rounded-xl bg-ink/10 dark:bg-white/10" />
        <div className="h-4 w-96 max-w-full rounded bg-ink/10 dark:bg-white/10" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="glass h-36 animate-pulse rounded-3xl" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="glass h-64 animate-pulse rounded-3xl xl:col-span-2" />
        <div className="glass h-64 animate-pulse rounded-3xl xl:col-span-2" />
        <div className="glass h-64 animate-pulse rounded-3xl" />
      </div>
      <div className="glass h-96 animate-pulse rounded-3xl" />
    </div>
  );
}
