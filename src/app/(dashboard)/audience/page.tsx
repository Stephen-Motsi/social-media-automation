import { isStaff, pageViewer } from "@/lib/session";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getAudienceTemplate } from "@/lib/audience";
import { SUBSCRIPTION_RULES } from "@/lib/policy/subscriptions";
import { CopyLink, SubscriberActions, TemplateForm, Topics } from "./widgets";
import { AddPeople } from "./add-people";

const STATUSES = {
  ACTIVE: { label: "Subscribed", className: "bg-wa/15 text-emerald-700 dark:text-emerald-300" },
  PENDING: { label: "Waiting to confirm", className: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  NEEDS_REVIEW: { label: "Needs review", className: "bg-amber-400/20 text-amber-800 dark:text-amber-200" },
  REJECTED: { label: "Rejected", className: "bg-danger/15 text-danger" },
  UNSUBSCRIBED: { label: "Unsubscribed", className: "bg-ink/10 text-ink-soft" },
} as const;

export const dynamic = "force-dynamic";

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function AudiencePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; topic?: string; status?: string }>;
}) {
  await pageViewer("staff");
  const { q = "", topic = "", status = "ACTIVE" } = await searchParams;
  const where: Prisma.SubscriberWhereInput = {
    ...(status in STATUSES ? { status: status as keyof typeof STATUSES } : {}),
    ...(topic ? { interests: { some: { id: topic } } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { phone: { contains: q.replace(/\D/g, "") || q } },
            { location: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [session, subscribers, total, active, unsubscribed, newThisWeek, interests, template, waiting, review] = await Promise.all([
    auth(),
    prisma.subscriber.findMany({ where, include: { interests: true, addedBy: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.subscriber.count({ where }),
    prisma.subscriber.count({ where: { status: "ACTIVE" } }),
    prisma.subscriber.count({ where: { status: "UNSUBSCRIBED" } }),
    prisma.subscriber.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.interest.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { subscribers: { where: { status: "ACTIVE" } } } } },
    }),
    getAudienceTemplate(),
    prisma.subscriber.count({ where: { status: "PENDING" } }),
    prisma.subscriber.count({ where: { status: "NEEDS_REVIEW" } }),
  ]);
  const admin = isStaff(session?.user?.role);
  const subscribeUrl = `${(process.env.AUTH_URL ?? "").replace(/\/$/, "")}/subscribe`;
  const stats = [
    { label: "Subscribed", value: active },
    { label: "Joined this week", value: newThisWeek },
    { label: "Waiting to confirm", value: waiting },
    { label: "Needs review", value: review },
    { label: "Unsubscribed", value: unsubscribed },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Audience</h1>
        <p className="mt-2 max-w-prose text-ink-soft">
          People who subscribed to receive adverts on WhatsApp, and the topics they chose. Adverts tagged with their
          topics are matched to them automatically and wait on Approvals.
        </p>
      </div>

      <section aria-label="Audience totals" className="glass grid grid-cols-2 divide-line rounded-3xl sm:grid-cols-5 sm:divide-x">
        {stats.map((s) => (
          <div key={s.label} className="px-5 py-4">
            <div className="text-sm text-ink-soft">{s.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</div>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {admin && (
          <section className="glass rounded-3xl p-6">
            <h2 className="text-lg font-semibold">Add people</h2>
            <p className="mt-1 text-sm text-ink-soft">
              People you add go through the same automatic checks as sign-ups. Record how they agreed to hear from you.
            </p>
            <div className="mt-4">
              <AddPeople topics={interests.map((i) => ({ id: i.id, name: i.name }))} />
            </div>
          </section>
        )}
        <section className="glass rounded-3xl p-6">
          <h2 className="text-lg font-semibold">Automatic approval</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Every subscription is checked against WhatsApp&rsquo;s rules and accepted automatically when it passes. Only
            flagged ones wait for you on Approvals.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {SUBSCRIPTION_RULES.map((r) => (
              <li key={r.label}>
                <span className="font-medium">{r.label}</span>
                <span className="text-ink-soft"> · {r.policy}</span>
                <span className="block text-xs text-ink-soft">If not: {r.onFail}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="glass space-y-5 rounded-3xl p-6">
          <div>
            <h2 className="text-lg font-semibold">Subscribe link</h2>
            <p className="mt-1 text-sm text-ink-soft">Share it on your pages, posters and WhatsApp status.</p>
            <div className="mt-3">
              <CopyLink url={subscribeUrl} />
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold">Topics</h2>
            <p className="mt-1 text-sm text-ink-soft">What people can subscribe to. Numbers are active subscribers.</p>
            <div className="mt-3">
              <Topics topics={interests.map((i) => ({ id: i.id, name: i.name, count: i._count.subscribers }))} admin={admin} />
            </div>
          </div>
        </section>

        <section className="glass rounded-3xl p-6">
          <h2 className="text-lg font-semibold">WhatsApp message template</h2>
          <p className="mt-1 text-sm text-ink-soft">
            WhatsApp only lets businesses start conversations with a template Meta has approved. Create a{" "}
            <strong className="font-medium text-ink">Marketing</strong> template in WhatsApp Manager with:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
            <li>Header: Image (the advert&rsquo;s picture is used)</li>
            <li>
              Body with two variables, e.g. <code className="text-ink">Hi {"{{1}}"}, {"{{2}}"}</code>: {"{{1}}"} is the
              subscriber&rsquo;s first name, {"{{2}}"} is the advert text
            </li>
            <li>Footer: &ldquo;Reply STOP to unsubscribe&rdquo;</li>
          </ul>
          <div className="mt-4">
            <TemplateForm template={template?.name ?? ""} lang={template?.lang ?? "en_US"} admin={admin} />
          </div>
        </section>
      </div>

      <section className="glass rounded-3xl p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold">
            Subscribers <span className="font-normal text-ink-soft tabular-nums">· {total}</span>
          </h2>
          <form className="flex flex-wrap gap-2" role="search">
            <input name="q" defaultValue={q} placeholder="Name, number or town" aria-label="Search subscribers" className="rounded-xl border border-line bg-white/55 px-3 py-2 text-sm dark:bg-white/5" />
            <select name="topic" defaultValue={topic} aria-label="Topic" className="rounded-xl border border-line bg-white/55 px-3 py-2 text-sm dark:bg-white/5">
              <option value="">All topics</option>
              {interests.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <select name="status" defaultValue={status} aria-label="Status" className="rounded-xl border border-line bg-white/55 px-3 py-2 text-sm dark:bg-white/5">
              {Object.entries(STATUSES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
              <option value="ALL">Everyone</option>
            </select>
            <button type="submit" className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-ink">
              Filter
            </button>
          </form>
        </div>

        {subscribers.length === 0 ? (
          <p className="mt-6 text-ink-soft">{q || topic || status !== "ACTIVE" ? "No subscribers match these filters." : "No subscribers yet. Share the subscribe link or add people above."}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs text-ink-soft">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">WhatsApp</th>
                  <th className="py-2 pr-3 font-medium">Town</th>
                  <th className="py-2 pr-3 font-medium">Topics</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Joined</th>
                  <th className="py-2 pr-3 font-medium">Last advert</th>
                  {admin && <th className="py-2 font-medium"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {subscribers.map((s) => (
                  <tr key={s.id} className={s.status === "ACTIVE" ? "" : "text-ink-soft"}>
                    <td className="py-2.5 pr-3 font-medium">{s.name}</td>
                    <td className="py-2.5 pr-3 tabular-nums">+{s.phone}</td>
                    <td className="py-2.5 pr-3">{s.location ?? "—"}</td>
                    <td className="py-2.5 pr-3">{s.interests.map((i) => i.name).join(", ")}</td>
                    <td className="py-2.5 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STATUSES[s.status].className}`}>
                        {STATUSES[s.status].label}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-soft">
                        {s.decidedBy?.startsWith("auto")
                          ? s.status === "ACTIVE"
                            ? "Accepted automatically"
                            : s.status === "NEEDS_REVIEW"
                              ? "Flagged automatically"
                              : s.status === "REJECTED"
                                ? "Rejected automatically"
                                : ""
                          : s.decidedBy
                            ? `By ${s.decidedBy}`
                            : ""}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3" title={s.consentText}>
                      {day.format(s.createdAt)}
                      <span className="block text-xs text-ink-soft">{s.addedBy ? `Added by ${s.addedBy.email}` : "Signed up"}</span>
                    </td>
                    <td className="py-2.5 pr-3">{s.lastSentAt ? day.format(s.lastSentAt) : "—"}</td>
                    {admin && (
                      <td className="py-2.5">
                        <SubscriberActions id={s.id} name={s.name} active={s.status === "ACTIVE"} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {total > subscribers.length && <p className="mt-3 text-xs text-ink-soft">Showing the newest {subscribers.length}. Use search to find others.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
