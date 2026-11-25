import { prisma } from "@/lib/db";

export async function userDashboard(userId: string) {
  const [user, drafts, scheduled, published, failed, recentDrafts, recentPosts, accounts, whatsapp] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        name: true,
        accounts: { select: { provider: true } },
        sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } },
        activity: { orderBy: { createdAt: "desc" }, take: 12 },
      },
    }),
    prisma.post.count({ where: { authorId: userId, status: "DRAFT", channelId: null, sourceAdvertId: null, listedAt: null } }),
    prisma.post.count({ where: { authorId: userId, status: "SCHEDULED" } }),
    prisma.post.count({ where: { authorId: userId, status: "PUBLISHED" } }),
    prisma.post.count({ where: { authorId: userId, status: "FAILED" } }),
    prisma.post.findMany({
      where: { authorId: userId, status: "DRAFT", channelId: null, sourceAdvertId: null, listedAt: null },
      select: { id: true, title: true, content: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    prisma.post.findMany({
      where: { authorId: userId, status: { not: "DRAFT" } },
      select: {
        id: true, content: true, status: true, scheduledAt: true, publishedAt: true, updatedAt: true,
        targets: {
          where: { account: { ownerId: userId } },
          select: { id: true, status: true, error: true, account: { select: { platform: true, displayName: true } } },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    prisma.socialAccount.findMany({
      where: { ownerId: userId },
      select: { id: true, platform: true, displayName: true, handle: true, disconnectedAt: true, tokenExpiresAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.whatsappConnectionRequest.findUnique({ where: { userId }, select: { status: true } }),
  ]);
  return { user, counts: { drafts, scheduled, published, failed }, recentDrafts, recentPosts, accounts, whatsapp };
}
