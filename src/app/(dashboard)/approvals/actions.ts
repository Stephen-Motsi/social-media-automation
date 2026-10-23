"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getAudienceTemplate } from "@/lib/audience";
import { handleMatches } from "@/lib/handles";
import { queueCampaign } from "@/lib/queue";

export type ApprovalState = { ok?: boolean; error?: string; message?: string } | undefined;

async function requireAdmin() {
  return (await requireStaff()).id;
}

const refresh = () => {
  revalidatePath("/approvals");
  revalidatePath("/", "layout");
};

export async function approveCampaign(id: string): Promise<ApprovalState> {
  const userId = await requireAdmin();
  const campaign = await prisma.campaign.findUnique({ where: { id }, include: { advert: true } });
  if (!campaign || campaign.status !== "PENDING_APPROVAL") return { error: "This advert is no longer waiting for approval." };

  // Fail early with a fixable message instead of a failed send.
  const checks = (campaign.advert.checks as { platform: string; status: string }[] | null) ?? [];
  if (checks.find((c) => c.platform === "WHATSAPP")?.status === "block") {
    return { error: "This advert can't be sent on WhatsApp. See the check below." };
  }
  if (!(await getAudienceTemplate())) return { error: "Set the WhatsApp message template on the Audience page first." };
  const channel = await prisma.channel.findUnique({ where: { platform: "WHATSAPP" } });
  const accounts = await prisma.socialAccount.findMany({ where: { platform: "WHATSAPP" } });
  if (!accounts.some((a) => handleMatches("WHATSAPP", channel?.handle, a))) {
    return { error: "Connect your WhatsApp number in the Meta container on Channels first." };
  }

  await prisma.campaign.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: userId } });
  await queueCampaign(id);
  refresh();
  return { ok: true, message: "Approved. Sending now." };
}

export async function rejectCampaign(id: string): Promise<ApprovalState> {
  await requireAdmin();
  const res = await prisma.campaign.updateMany({
    where: { id, status: "PENDING_APPROVAL" },
    data: { status: "REJECTED", rejectedAt: new Date() },
  });
  if (res.count === 0) return { error: "This advert is no longer waiting for approval." };
  refresh();
  return { ok: true, message: "Rejected. It won't be proposed again." };
}
