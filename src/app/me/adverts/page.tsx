import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatWhen } from "@/lib/errors";
import { isStaff, pageViewer } from "@/lib/session";
import { UserHeader } from "../header";

export const dynamic = "force-dynamic";

export default async function UserAdvertsPage() {
  const viewer = await pageViewer("user");
  const drafts = await prisma.post.findMany({
    where: { authorId: viewer.id, status: "DRAFT", channelId: null, sourceAdvertId: null, listedAt: null },
    select: { id: true, title: true, content: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  return (
    <div className="min-h-screen pb-16">
      <UserHeader email={viewer.email} current="/me/adverts" staff={isStaff(viewer.role)} />
      <main className="rise mx-auto max-w-5xl space-y-6 px-4 pt-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">Your drafts</h1>
            <p className="mt-2 text-ink-soft">Continue working on your own adverts.</p>
          </div>
          <Link href="/me/create" className="blend-meta rounded-full px-5 py-3 text-sm font-medium text-white">Create advert</Link>
        </div>
        {drafts.length === 0 ? <p className="glass rounded-3xl p-6 text-ink-soft">No drafts yet.</p> : (
          <ul className="glass divide-y divide-line rounded-3xl px-6">
            {drafts.map((draft) => (
              <li key={draft.id} className="py-4">
                <Link href={`/me/create?id=${encodeURIComponent(draft.id)}`} className="font-medium underline-offset-2 hover:underline">
                  {draft.title || draft.content.slice(0, 60) || "Untitled draft"}
                </Link>
                <p className="mt-1 text-xs text-ink-soft">Updated {formatWhen(draft.updatedAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
