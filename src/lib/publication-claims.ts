import type { TargetStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function claimPostTarget(id: string, status: TargetStatus) {
  if (status !== "PENDING" && status !== "FAILED") return false;
  const claimed = await prisma.postTarget.updateMany({
    where: { id, status },
    data: { status: "IN_FLIGHT", error: "Publishing in progress; reconcile before retrying if interrupted." },
  });
  return claimed.count === 1;
}

export async function publishClaimedTarget(id: string, send: () => Promise<string>) {
  try {
    const externalPostId = await send();
    await prisma.postTarget.update({ where: { id }, data: { status: "PUBLISHED", externalPostId, error: null } });
  } catch (error) {
    await prisma.postTarget.update({
      where: { id },
      data: { status: "IN_FLIGHT", error: `Publishing outcome unknown; reconcile before retrying. ${error instanceof Error ? error.message : String(error)}` },
    });
  }
}

export async function claimCampaignDelivery(id: string) {
  const claimed = await prisma.delivery.updateMany({
    where: { id, status: "PENDING", externalId: null },
    data: { status: "IN_FLIGHT", error: "Delivery in progress; reconcile before retrying if interrupted." },
  });
  return claimed.count === 1;
}
