import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const [accounts, scheduled, published, failed] = await Promise.all([
    prisma.socialAccount.count(),
    prisma.post.count({ where: { status: "SCHEDULED" } }),
    prisma.post.count({ where: { status: "PUBLISHED" } }),
    prisma.post.count({ where: { status: "FAILED" } }),
  ]);

  const stats = [
    { label: "Connected accounts", value: accounts },
    { label: "Scheduled posts", value: scheduled },
    { label: "Published posts", value: published },
    { label: "Failed posts", value: failed },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold">Overview</h1>
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="text-sm text-neutral-500">{s.label}</div>
            <div className="mt-1 text-2xl font-semibold">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
