import type { Metadata } from "next";
import Link from "next/link";
import { listedAdverts } from "@/lib/adverts";
import { getViewer, isStaff } from "@/lib/session";
import { PlatformBadge, platforms } from "@/components/platforms";

export const dynamic = "force-dynamic";

const BRAND = process.env.BRAND_NAME ?? "Social Automation";
export const metadata: Metadata = { title: BRAND, description: `Subscribe to ${BRAND} adverts on the platforms you use.` };

export default async function LandingPage() {
  const [adverts, viewer] = await Promise.all([listedAdverts(), getViewer()]);
  const dashboard = viewer ? (isStaff(viewer.role) ? "/admin" : "/me") : null;

  return (
    <div className="min-h-screen pb-16">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 pt-6">
        <span className="font-semibold tracking-tight">{BRAND}</span>
        {dashboard ? (
          <Link href={dashboard} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-ink">
            My dashboard
          </Link>
        ) : (
          <Link href="/login" className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-ink">
            Sign in
          </Link>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4">
        <section className="pt-14 pb-10">
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">Pick the adverts you want, where you want them</h1>
          <p className="mt-4 max-w-2xl text-lg text-ink-soft">
            Subscribe to an advert on Facebook, Instagram, WhatsApp, X or TikTok. WhatsApp adverts come straight to your
            number; on the other platforms you&rsquo;ll see where each one is posted.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={dashboard ?? "/login?callbackUrl=/me"}
              className="blend-meta rounded-full px-6 py-3 font-medium text-white shadow-md shadow-fuchsia-500/25"
            >
              {dashboard ? "Choose adverts" : "Sign in to subscribe"}
            </Link>
            <Link href="/subscribe" className="rounded-full px-5 py-3 text-ink-soft hover:text-ink">
              No account? Get offers by topic on WhatsApp
            </Link>
          </div>
        </section>

        {adverts.length === 0 ? (
          <p className="glass rounded-[28px] px-6 py-12 text-center text-ink-soft">New adverts are on their way.</p>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {adverts.map((a) => (
              <li key={a.id} id={a.id}>
                <article className="glass flex h-full flex-col overflow-hidden rounded-[28px]">
                  {a.mediaUrls[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.mediaUrls[0]} alt="" className="aspect-square w-full object-cover" />
                  )}
                  <div className="flex flex-1 flex-col p-5">
                    <h2 className="text-lg font-semibold">{a.title ?? "Advert"}</h2>
                    {a.about && <p className="mt-1 text-sm text-ink-soft">{a.about}</p>}
                    {a.interests.length > 0 && (
                      <p className="mt-2 text-xs text-ink-soft">{a.interests.map((i) => i.name).join(" · ")}</p>
                    )}
                    <ul className="mt-4 flex flex-wrap gap-2" aria-label="Available on">
                      {a.platforms.map((p) => (
                        <li key={p.platform} className="flex items-center gap-1.5 rounded-full border border-line bg-white/40 py-1 pr-3 pl-1 text-xs dark:bg-white/5">
                          <PlatformBadge platform={p.platform} />
                          {p.url ? (
                            <a href={p.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                              {p.handle}
                            </a>
                          ) : (
                            <span>{platforms[p.platform].name}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                    <Link
                      href={dashboard === "/me" ? `/me#${a.id}` : dashboard ? "/admin/adverts" : `/login?callbackUrl=${encodeURIComponent(`/me#${a.id}`)}`}
                      className="mt-auto pt-5 text-sm font-medium underline-offset-2 hover:underline"
                    >
                      {dashboard === "/me" ? "Subscribe" : dashboard ? "Manage in admin" : "Sign in to subscribe"}
                    </Link>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
