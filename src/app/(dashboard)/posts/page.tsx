import { pageViewer } from "@/lib/session";
import { prisma } from "@/lib/db";
import { displayHandle, handleMatches } from "@/lib/handles";
import { formatWhen } from "@/lib/errors";
import { formatSupport, platformOrder } from "@/lib/policy/rules";
import { postUrl } from "@/lib/adverts";
import { PlatformBadge, platforms } from "@/components/platforms";
import { CancelPost, PostComposer, type PlatformChoice } from "./composer";

export const dynamic = "force-dynamic";

const statusCopy: Record<string, { label: string; className: string }> = {
  SCHEDULED: { label: "Scheduled", className: "bg-[var(--ig-3)]/15 text-[var(--ig-3)]" },
  PUBLISHING: { label: "Posting", className: "bg-amber-400/20 text-amber-800 dark:text-amber-200" },
  PUBLISHED: { label: "Posted", className: "bg-wa/15 text-emerald-700 dark:text-emerald-300" },
  FAILED: { label: "Not posted", className: "bg-danger/15 text-danger" },
};

export default async function PostsPage() {
  await pageViewer("staff");
  const [posts, channels, accounts] = await Promise.all([
    prisma.post.findMany({
      where: { status: { not: "DRAFT" } },
      orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
      include: { targets: { include: { account: true } }, sourceAdvert: { select: { title: true } }, channel: { select: { platform: true } } },
      take: 50,
    }),
    prisma.channel.findMany(),
    prisma.socialAccount.findMany(),
  ]);

  const choices: PlatformChoice[] = platformOrder.map((platform) => {
    const channel = channels.find((c) => c.platform === platform);
    const connected = accounts.some((a) => a.platform === platform && handleMatches(platform, channel?.handle, a));
    return {
      platform,
      handle: channel?.handle ? displayHandle(platform, channel.handle) : null,
      story: formatSupport[platform].STORY,
      disabledReason:
        platform === "WHATSAPP"
          ? "WhatsApp Status can't be posted by business tools (Meta's API doesn't offer it). Publish an advert to reach people on their WhatsApp."
          : connected
            ? null
            : "Not connected. Connect it in Settings on Channels.",
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Posts</h1>
        <p className="mt-2 max-w-prose text-ink-soft">
          Schedule posts and stories on your accounts for your followers, and see everything that has gone out or is
          waiting, including adverts and channel schedules.
        </p>
      </div>

      <PostComposer choices={choices} />

      <section aria-labelledby="list-h" className="space-y-3">
        <h2 id="list-h" className="text-lg font-semibold">Scheduled and sent</h2>
        {posts.length === 0 ? (
          <p className="glass rounded-[28px] px-6 py-10 text-center text-ink-soft">Nothing yet.</p>
        ) : (
          <ul className="space-y-3">
            {posts.map((p, n) => {
              const s = statusCopy[p.status] ?? statusCopy.FAILED;
              const kind = p.targets[0]?.format === "STORY" ? "Story" : "Post";
              const from = p.sourceAdvert ? `Advert: ${p.sourceAdvert.title ?? "Untitled"}` : p.channel ? `${platforms[p.channel.platform].name} schedule` : kind;
              return (
                <li key={p.id} style={{ "--i": Math.min(n, 8) } as React.CSSProperties} className="glass lift rise flex gap-4 rounded-2xl p-4">
                  {p.mediaUrls[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.mediaUrls[0]} alt="" className="size-16 shrink-0 rounded-xl object-cover" />
                  )}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>
                      <span className="font-medium">{from}</span>
                      <span className="text-ink-soft">
                        {p.status === "PUBLISHED" && p.publishedAt ? formatWhen(p.publishedAt) : p.scheduledAt ? formatWhen(p.scheduledAt) : ""}
                      </span>
                      {p.status === "SCHEDULED" && p.scheduledAt && p.scheduledAt > new Date() && (
                        <span className="ml-auto">
                          <CancelPost id={p.id} />
                        </span>
                      )}
                    </div>
                    {p.content && <p className="line-clamp-2 text-sm whitespace-pre-wrap">{p.content}</p>}
                    <ul className="space-y-0.5 text-xs">
                      {p.targets.map((t) => {
                        const url = t.status === "PUBLISHED" ? postUrl(t.account.platform, t.externalPostId, t.account.handle) : null;
                        return (
                          <li key={t.id} className="flex items-start gap-1.5">
                            <PlatformBadge platform={t.account.platform} />
                            <span className={t.status === "FAILED" ? "text-danger" : "text-ink-soft"}>
                              {t.recipient ? `to +${t.recipient}` : t.account.displayName}:{" "}
                              {t.status === "PUBLISHED" ? (
                                url ? (
                                  <a href={url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                                    posted
                                  </a>
                                ) : (
                                  "posted"
                                )
                              ) : t.status === "FAILED" ? (
                                t.error ?? "failed"
                              ) : (
                                "waiting"
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
