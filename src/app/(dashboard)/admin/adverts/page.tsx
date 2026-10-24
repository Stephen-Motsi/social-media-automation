import Link from "next/link";
import { prisma } from "@/lib/db";
import { pageViewer } from "@/lib/session";
import type { PlatformVerdict } from "@/lib/policy/rules";
import { PlatformBadge, platforms } from "@/components/platforms";
import { AdvertButtons } from "../buttons";
import { advertStatus } from "@/lib/adverts";
import { formatWhen } from "@/lib/errors";

export const dynamic = "force-dynamic";

const statusDot = { pass: "bg-wa", warn: "bg-amber-500", block: "bg-danger" } as const;

export default async function AdvertsPage() {
  await pageViewer("staff");
  const adverts = await prisma.post.findMany({
    where: { status: "DRAFT", channelId: null },
    orderBy: { createdAt: "desc" },
    include: { interests: true, subscriptions: { select: { platform: true } }, advertPosts: { select: { id: true } } },
    take: 100,
  });
  const statuses = new Map(await Promise.all(adverts.filter((a) => a.listedAt).map(async (a) => [a.id, await advertStatus(a.id)] as const)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Adverts</h1>
          <p className="mt-2 max-w-prose text-ink-soft">
            Published adverts are shown on the home page and users&rsquo; dashboards, where users subscribe per
            platform. At the send time it&rsquo;s posted on your handles, and WhatsApp subscribers get it on their
            own number.
          </p>
        </div>
        <Link href="/create" className="blend-meta rounded-full px-5 py-2.5 font-medium text-white shadow-md shadow-fuchsia-500/25">
          Create advert
        </Link>
      </div>

      {adverts.length === 0 ? (
        <p className="glass rounded-[28px] px-6 py-12 text-center text-ink-soft">No adverts yet. Create one to get started.</p>
      ) : (
        <ul className="space-y-4">
          {adverts.map((a, n) => {
            const checks = (a.checks as PlatformVerdict[] | null) ?? [];
            const count = (p: string) => a.subscriptions.filter((s) => s.platform === p).length;
            return (
              <li key={a.id} className="rise" style={{ "--i": Math.min(n, 8) } as React.CSSProperties}>
                <article className="glass lift flex flex-col gap-4 overflow-hidden rounded-[28px] p-5 sm:flex-row">
                  {a.mediaUrls[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <span className="size-28 shrink-0 overflow-hidden rounded-2xl"><img src={a.mediaUrls[0]} alt="" className="zoom size-28 object-cover" /></span>
                  ) : (
                    <div className="size-28 shrink-0 rounded-2xl border border-dashed border-line" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h2 className="font-semibold">{a.title ?? <span className="text-ink-soft">Untitled</span>}</h2>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.listedAt ? "bg-wa/15 text-emerald-700 dark:text-emerald-300" : "bg-ink/10 text-ink-soft"}`}>
                        {a.listedAt ? "Published" : "Draft"}
                      </span>
                      {a.listedAt && a.sendAt && a.sendAt > new Date() && <span className="text-xs text-ink-soft">goes out {formatWhen(a.sendAt)}</span>}
                    </div>
                    {a.about && <p className="text-sm text-ink-soft">{a.about}</p>}
                    <p className="line-clamp-2 text-sm">{a.content}</p>
                    <ul className="flex flex-wrap gap-2">
                      {a.targetPlatforms.map((p) => {
                        const v = checks.find((c) => c.platform === p);
                        return (
                          <li key={p} className="flex items-center gap-1.5 rounded-full border border-line py-1 pr-3 pl-1 text-xs" title={v?.issues.map((i) => i.message).join(" ")}>
                            <PlatformBadge platform={p} />
                            {platforms[p].name}
                            {v && <span aria-label={`check: ${v.status}`} className={`size-2 rounded-full ${statusDot[v.status]}`} />}
                            <span className="text-ink-soft tabular-nums">· {count(p)} subscribed</span>
                          </li>
                        );
                      })}
                      {a.targetPlatforms.length === 0 && <li className="text-xs text-ink-soft">No target platforms (used by Channels and topic sends only)</li>}
                    </ul>
                    {statuses.get(a.id) && (
                      <ul className="space-y-0.5 text-xs" aria-label="Where it stands">
                        {statuses.get(a.id)!.map((o) => (
                          <li key={o.platform} className="flex gap-1.5">
                            <span aria-hidden className={`mt-1 size-1.5 shrink-0 rounded-full ${o.ok ? "bg-wa" : "bg-danger"}`} />
                            <span className={o.ok ? "text-ink-soft" : "text-danger"}>{o.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <AdvertButtons id={a.id} listed={!!a.listedAt} />
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
