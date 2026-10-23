import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { PlatformVerdict } from "@/lib/policy/rules";
import { Decision } from "./decision";
import { ReviewDecision } from "../audience/add-people";
import type { SubscriptionCheck } from "@/lib/policy/subscriptions";

export const dynamic = "force-dynamic";

const when = new Intl.DateTimeFormat("en-GB", {
  timeZone: process.env.APP_TIMEZONE ?? "Africa/Nairobi",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const verdictCopy: Record<PlatformVerdict["status"], { label: string; className: string }> = {
  pass: { label: "WhatsApp check: ready", className: "bg-wa/15 text-emerald-700 dark:text-emerald-300" },
  warn: { label: "WhatsApp check: review", className: "bg-amber-400/20 text-amber-800 dark:text-amber-200" },
  block: { label: "WhatsApp check: can't send", className: "bg-danger/15 text-danger" },
};

const statusLabel: Record<string, string> = {
  APPROVED: "Approved, queued",
  SENDING: "Sending",
  SENT: "Sent",
  REJECTED: "Rejected",
  FAILED: "Failed",
};

function tally<T extends string>(values: T[]) {
  const m = new Map<T, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export default async function ApprovalsPage() {
  const [session, pending, history, toReview, waiting] = await Promise.all([
    auth(),
    prisma.campaign.findMany({
      where: { status: "PENDING_APPROVAL" },
      orderBy: { createdAt: "asc" },
      include: {
        advert: { include: { interests: true } },
        deliveries: { where: { subscriber: { status: "ACTIVE" } }, include: { subscriber: { include: { interests: true } } } },
      },
    }),
    prisma.campaign.findMany({
      where: { status: { not: "PENDING_APPROVAL" } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { advert: true, approvedBy: true, deliveries: { select: { status: true } } },
    }),
    prisma.subscriber.findMany({ where: { status: "NEEDS_REVIEW" }, orderBy: { createdAt: "asc" }, include: { interests: true, addedBy: true } }),
    prisma.subscriber.count({ where: { status: "PENDING" } }),
  ]);
  const admin = session?.user?.role === "ADMIN";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Approvals</h1>
        <p className="mt-2 max-w-prose text-ink-soft">
          Subscriptions that pass WhatsApp&rsquo;s rules are accepted automatically, and adverts are matched to
          subscribers automatically. You only decide on flagged subscriptions and approve each send.
        </p>
      </div>

      <section className="glass rounded-[32px] p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Subscriptions to review</h2>
          <p className="text-sm text-ink-soft">{waiting} waiting for people to confirm on WhatsApp (accepted automatically when they do)</p>
        </div>
        {toReview.length === 0 ? (
          <p className="mt-3 text-ink-soft">None. Everything else was accepted or rejected automatically.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {toReview.map((s) => {
              const flagged = ((s.checks as SubscriptionCheck[] | null) ?? []).filter((c) => c.result === "review");
              return (
                <li key={s.id} className="space-y-2 py-4">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-sm text-ink-soft tabular-nums">+{s.phone}</span>
                    <span className="text-sm text-ink-soft">
                      {s.location ?? "No town"} · {s.interests.map((i) => i.name).join(", ")} · {s.addedBy ? `added by ${s.addedBy.email}` : "signed up"}
                    </span>
                  </div>
                  <ul className="text-sm">
                    {flagged.map((c) => (
                      <li key={c.code} className="text-amber-800 dark:text-amber-200">
                        {c.label}: {c.detail}
                      </li>
                    ))}
                  </ul>
                  {admin && <ReviewDecision id={s.id} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {pending.length === 0 ? (
        <div className="glass rounded-[32px] px-6 py-12 text-center">
          <p className="text-lg font-medium">No adverts waiting</p>
          <p className="mx-auto mt-2 max-w-md text-ink-soft">
            When an advert tagged with topics matches subscribers, it appears here for approval.
          </p>
        </div>
      ) : (
        <ul className="space-y-6">
          {pending.map((c) => {
            const subs = c.deliveries.map((d) => d.subscriber);
            const verdict = ((c.advert.checks as PlatformVerdict[] | null) ?? []).find((v) => v.platform === "WHATSAPP");
            const byTown = tally(subs.map((s) => s.location ?? "No town given")).slice(0, 5);
            const advertTopics = new Set(c.advert.interests.map((i) => i.id));
            const byTopic = tally(subs.flatMap((s) => s.interests.filter((i) => advertTopics.has(i.id)).map((i) => i.name)));
            return (
              <li key={c.id}>
                <article className="glass grid gap-6 rounded-[32px] p-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                  <div>
                    {c.advert.mediaUrls[0] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.advert.mediaUrls[0]} alt="" className="aspect-square w-full rounded-2xl object-cover" />
                    )}
                    <p className="mt-3 whitespace-pre-wrap">{c.advert.content}</p>
                  </div>
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                      <span>{c.reason}</span>
                      <span aria-hidden>·</span>
                      <span>proposed {when.format(c.createdAt)}</span>
                    </div>
                    <div>
                      <p className="text-3xl font-semibold tabular-nums">
                        {subs.length} <span className="text-base font-normal text-ink-soft">{subs.length === 1 ? "subscriber" : "subscribers"}</span>
                      </p>
                      <p className="mt-1 text-sm text-ink-soft">
                        Topics: {c.advert.interests.map((i) => i.name).join(", ")}
                        {c.advert.targetLocations.length ? ` · Towns: ${c.advert.targetLocations.join(", ")}` : " · All towns"}
                      </p>
                    </div>
                    <dl className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <dt className="text-xs text-ink-soft">By topic</dt>
                        <dd className="mt-1 space-y-0.5">
                          {byTopic.map(([t, n]) => (
                            <div key={t} className="flex justify-between gap-2"><span>{t}</span><span className="tabular-nums text-ink-soft">{n}</span></div>
                          ))}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-ink-soft">By town</dt>
                        <dd className="mt-1 space-y-0.5">
                          {byTown.map(([t, n]) => (
                            <div key={t} className="flex justify-between gap-2"><span>{t}</span><span className="tabular-nums text-ink-soft">{n}</span></div>
                          ))}
                        </dd>
                      </div>
                    </dl>
                    <p className="text-sm text-ink-soft">
                      Includes {subs.slice(0, 4).map((s) => s.name).join(", ")}
                      {subs.length > 4 ? ` and ${subs.length - 4} more` : ""}.
                    </p>
                    {verdict && (
                      <div className="rounded-2xl border border-line bg-white/35 p-3 text-sm dark:bg-white/5">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${verdictCopy[verdict.status].className}`}>
                          {verdictCopy[verdict.status].label}
                        </span>
                        {verdict.issues.length > 0 && (
                          <ul className="mt-2 space-y-1 text-ink-soft">
                            {verdict.issues.map((i) => (
                              <li key={i.code}>{i.message}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    <Decision id={c.id} count={subs.length} admin={admin} />
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {history.length > 0 && (
        <section className="glass rounded-3xl p-6">
          <h2 className="text-lg font-semibold">History</h2>
          <ul className="mt-4 divide-y divide-line">
            {history.map((c) => {
              const counts = tally(c.deliveries.map((d) => d.status));
              return (
                <li key={c.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{c.advert.content || "(image only)"}</span>
                  <span className={c.status === "FAILED" ? "text-danger" : "text-ink-soft"}>{statusLabel[c.status] ?? c.status}</span>
                  <span className="text-ink-soft tabular-nums">
                    {counts.map(([s, n]) => `${n} ${s.toLowerCase()}`).join(" · ") || "—"}
                  </span>
                  <span className="text-ink-soft">
                    {c.approvedBy ? `by ${c.approvedBy.email}` : ""} {when.format(c.approvedAt ?? c.rejectedAt ?? c.createdAt)}
                  </span>
                  {c.error && <span className="w-full text-danger">{c.error}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
