import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { NavLinks } from "@/components/nav-links";

// Three overlapping dots, one per channel.
function BrandMark() {
  return (
    <span aria-hidden className="relative flex h-6 w-9 items-center">
      <span className="blend-facebook absolute left-0 size-4 rounded-full ring-2 ring-white/70" />
      <span className="blend-instagram absolute left-2.5 size-4 rounded-full ring-2 ring-white/70" />
      <span className="blend-whatsapp absolute left-5 size-4 rounded-full ring-2 ring-white/70" />
    </span>
  );
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, pendingSends, flaggedSubscriptions] = await Promise.all([
    auth(),
    prisma.campaign.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.subscriber.count({ where: { status: "NEEDS_REVIEW" } }),
  ]);
  const pendingApprovals = pendingSends + flaggedSubscriptions;

  return (
    <div className="min-h-screen pb-16">
      <header className="sticky top-4 z-20 px-4">
        <div className="glass mx-auto flex max-w-6xl items-center gap-2 rounded-full py-2 pr-2 pl-3 sm:gap-3 sm:pl-4">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <BrandMark />
            <span className="hidden whitespace-nowrap xl:inline">Social Automation</span>
          </span>
          <NavLinks pendingApprovals={pendingApprovals} superAdmin={session?.user?.role === "SUPER_ADMIN"} />
          <form
            className="ml-auto flex shrink-0 items-center gap-3 text-sm"
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <span className="hidden text-ink-soft 2xl:inline">{session?.user?.email}</span>
            <button
              type="submit"
              className="flex items-center rounded-full px-2 py-1.5 whitespace-nowrap text-ink-soft transition-colors hover:bg-white/40 hover:text-ink sm:px-3 dark:hover:bg-white/10"
            >
              <svg viewBox="0 0 24 24" aria-hidden className="size-5 sm:hidden" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" />
              </svg>
              <span className="sr-only sm:not-sr-only">Sign out</span>
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-10">{children}</main>
    </div>
  );
}
