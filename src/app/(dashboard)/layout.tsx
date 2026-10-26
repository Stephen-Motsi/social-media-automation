import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, pendingSends, flaggedSubscriptions, unread] = await Promise.all([
    auth(),
    prisma.campaign.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.subscriber.count({ where: { status: "NEEDS_REVIEW" } }),
    prisma.notification.count({ where: { readAt: null } }),
  ]);
  const pendingApprovals = pendingSends + flaggedSubscriptions;

  return (
    <DashboardShell
      email={session?.user?.email ?? ""}
      name={session?.user?.name ?? ""}
      role={session?.user?.role ?? "USER"}
      pendingApprovals={pendingApprovals}
      unread={unread}
      signOutAction={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      {children}
    </DashboardShell>
  );
}
