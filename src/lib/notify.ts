import { prisma } from "@/lib/db";

// In-app notifications for the admins (the bell in the admin header). Never fails the caller.
export async function notifyAdmins(n: { kind: string; title: string; body?: string | null; link?: string | null; userId?: string | null }) {
  await prisma.notification
    .create({ data: { kind: n.kind, title: n.title.slice(0, 300), body: n.body?.slice(0, 1000) ?? null, link: n.link ?? null, userId: n.userId ?? null } })
    .catch((err) => console.error("Notification failed:", err instanceof Error ? err.message : err));
}
