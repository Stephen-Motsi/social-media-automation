"use client";

export default function SuperAdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section role="alert" className="glass mx-auto max-w-xl rounded-3xl px-6 py-12 text-center">
      <h2 className="text-xl font-semibold">Dashboard couldn&rsquo;t load</h2>
      <p className="mt-2 text-sm text-ink-soft">The dashboard data is temporarily unavailable. Try again, or check that the database connection is running.</p>
      <button type="button" onClick={reset} className="blend-meta mt-5 rounded-full px-5 py-2.5 text-sm font-medium text-white">Try again</button>
    </section>
  );
}
