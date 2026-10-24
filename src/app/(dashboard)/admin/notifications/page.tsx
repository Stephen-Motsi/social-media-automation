import Link from "next/link";
import { prisma } from "@/lib/db";
import { pageViewer } from "@/lib/session";
import { markAllRead, markRead } from "./actions";

export const dynamic = "force-dynamic";

const when = new Intl.DateTimeFormat("en-GB", {
  timeZone: process.env.APP_TIMEZONE ?? "Africa/Nairobi",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const kinds: Record<string, { label: string; dot: string }> = {
  SUBSCRIBED: { label: "New subscription", dot: "bg-wa" },
  SEND_FAILED: { label: "Couldn't send", dot: "bg-danger" },
};

// What's happened that admins should know about: new subscriptions (sent automatically) and failed sends.
export default async function NotificationsPage() {
  await pageViewer("staff");
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.notification.count({ where: { readAt: null } }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Notifications</h1>
          <p className="mt-2 max-w-prose text-ink-soft">
            Every new subscription, and any advert that couldn&rsquo;t be sent to someone. Subscribed adverts are sent
            automatically; nothing here needs approving.
          </p>
        </div>
        {unread > 0 && (
          <form action={markAllRead}>
            <button type="submit" className="rounded-full border border-line bg-white/55 px-4 py-2 text-sm font-medium hover:bg-white/80 dark:bg-white/10">
              Mark all as read ({unread})
            </button>
          </form>
        )}
      </div>

      {items.length === 0 ? (
        <p className="glass rounded-[28px] px-6 py-12 text-center text-ink-soft">Nothing yet. When someone subscribes, it shows here.</p>
      ) : (
        <ul className="glass divide-y divide-line overflow-hidden rounded-[28px]">
          {items.map((n, i) => {
            const k = kinds[n.kind] ?? { label: n.kind.toLowerCase(), dot: "bg-ink-soft" };
            return (
              <li key={n.id} className={`rise flex gap-3 px-5 py-4 transition-colors hover:bg-white/35 dark:hover:bg-white/5 ${n.readAt ? "" : "bg-white/40 dark:bg-white/[0.06]"}`} style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
                <span aria-hidden className={`mt-1.5 size-2.5 shrink-0 rounded-full ${k.dot} ${n.readAt ? "opacity-40" : ""}`} />
                <div className="min-w-0 flex-1">
                  <p className={n.readAt ? "" : "font-semibold"}>
                    {n.link ? (
                      <Link href={n.link} className="hover:underline">
                        {n.title}
                      </Link>
                    ) : (
                      n.title
                    )}
                  </p>
                  {n.body && <p className="mt-0.5 text-sm text-ink-soft">{n.body}</p>}
                  <p className="mt-1 text-xs text-ink-soft">
                    {k.label} · {when.format(n.createdAt)}
                    {!n.readAt && <span className="sr-only"> · unread</span>}
                  </p>
                </div>
                {!n.readAt && (
                  <form action={markRead.bind(null, n.id)}>
                    <button type="submit" className="rounded-full px-3 py-1 text-xs text-ink-soft hover:bg-white/50 hover:text-ink dark:hover:bg-white/10">
                      Mark read
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
