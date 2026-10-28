"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center justify-center px-6">
      <div className="w-full rounded-3xl border border-line bg-white/70 p-8 shadow-sm backdrop-blur dark:bg-white/5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ig-3)]">Something went wrong</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">We couldn’t load this page.</h1>
        <p className="mt-3 text-sm leading-6 text-ink-soft">
          {error.message || "An unexpected error occurred while rendering this page."}
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-6 rounded-full bg-ink px-5 py-3 text-sm font-medium text-white dark:bg-white dark:text-ink"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
