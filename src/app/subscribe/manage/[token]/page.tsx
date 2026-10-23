import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ManageForm } from "../../forms";
import { COMMON_LOCATIONS } from "@/lib/audience";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your subscription", robots: { index: false } };

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [sub, interests] = await Promise.all([
    prisma.subscriber.findUnique({ where: { manageToken: token }, include: { interests: true } }),
    prisma.interest.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (!sub) notFound();
  const masked = `+${sub.phone.slice(0, 3)} ••• ${sub.phone.slice(-3)}`;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="glass w-full max-w-lg rounded-[32px] p-6 sm:p-9">
        <h1 className="text-3xl font-semibold tracking-tight">Your subscription</h1>
        <p className="mt-2 text-ink-soft">
          {sub.name} · {masked}
        </p>
        <div className="mt-8">
          <ManageForm
            token={token}
            interests={interests.map((i) => ({ id: i.id, name: i.name }))}
            locations={COMMON_LOCATIONS}
            selected={sub.interests.map((i) => i.id)}
            location={sub.location ?? ""}
            active={sub.status === "ACTIVE"}
          />
        </div>
      </div>
    </main>
  );
}
