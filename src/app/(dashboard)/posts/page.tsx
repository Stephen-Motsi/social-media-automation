import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PostsPage() {
  const posts = await prisma.post.findMany({
    orderBy: { createdAt: "desc" },
    include: { targets: { include: { account: true } } },
    take: 50,
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold">Posts</h1>

      {/* TODO: composer form -> create Post + PostTargets, then schedulePost() from src/lib/queue.ts */}

      {posts.length === 0 ? (
        <p className="mt-8 text-neutral-500">No posts yet.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {posts.map((p) => (
            <li
              key={p.id}
              className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex justify-between text-sm text-neutral-500">
                <span>{p.status}</span>
                <span>{p.scheduledAt?.toLocaleString() ?? "Not scheduled"}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap">{p.content}</p>
              <div className="mt-2 text-xs text-neutral-500">
                {p.targets.map((t) => `${t.account.platform}: ${t.status}`).join(" · ")}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
