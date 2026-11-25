import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { DashboardShell } from "@/components/dashboard-shell";
import { isStaff } from "@/lib/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const [pendingSends, flaggedSubscriptions, pendingAdvertReviews, unread] = isStaff(session?.user?.role) ? await Promise.all([
    prisma.campaign.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.subscriber.count({ where: { status: "NEEDS_REVIEW" } }),
    prisma.post.count({ where: { status: "DRAFT", channelId: null, reviewStatus: "PENDING_REVIEW" } }),
    prisma.notification.count({ where: { readAt: null } }),
  ]) : [0, 0, 0, 0];
  const pendingApprovals = pendingSends + flaggedSubscriptions + pendingAdvertReviews;

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
