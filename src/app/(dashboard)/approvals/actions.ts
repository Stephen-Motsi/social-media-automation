"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/session";
import { prisma } from "@/lib/db";
import { whatsappNotReady } from "@/lib/audience";
import { formatWhen, reasonFor } from "@/lib/errors";
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
  const notReady = await whatsappNotReady();
  if (notReady) return { error: `Can't send yet: ${notReady}` };

  // Goes out at the advert's send time, or now if that has passed.
  const sendAt = campaign.advert.sendAt && campaign.advert.sendAt > new Date() ? campaign.advert.sendAt : null;
  await prisma.campaign.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: userId, sendAt } });
  try {
    await queueCampaign(id, sendAt);
  } catch (err) {
    refresh();
    return { error: `Approved, but ${reasonFor(err)}` };
  }
  refresh();
  return { ok: true, message: sendAt ? `Approved. It goes out ${formatWhen(sendAt)}.` : "Approved. Sending now." };
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
