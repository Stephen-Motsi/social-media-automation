"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export type AudienceState = { ok?: boolean; error?: string; message?: string } | undefined;

async function requireAdmin() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") throw new Error("Only admins can change the audience.");
}

const refresh = () => {
  revalidatePath("/audience");
  revalidatePath("/subscribe");
};

export async function addInterest(_prev: AudienceState, formData: FormData): Promise<AudienceState> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 40) return { error: "Topic names need 2 to 40 characters." };
  const exists = await prisma.interest.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (exists) return { error: `"${exists.name}" already exists.` };
  await prisma.interest.create({ data: { name } });
  refresh();
  return { ok: true, message: `Added "${name}".` };
}

// Subscribers and adverts simply lose the topic; nobody is deleted.
export async function deleteInterest(id: string): Promise<AudienceState> {
  await requireAdmin();
  await prisma.interest.delete({ where: { id } }).catch(() => null);
  refresh();
  return { ok: true };
}

export async function saveTemplate(_prev: AudienceState, formData: FormData): Promise<AudienceState> {
  await requireAdmin();
  const name = String(formData.get("template") ?? "").trim();
  const lang = String(formData.get("lang") ?? "").trim() || "en_US";
  if (!/^[a-z0-9_]{1,512}$/.test(name)) return { error: "Template names use lowercase letters, numbers and underscores, exactly as in WhatsApp Manager." };
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(lang)) return { error: "Language codes look like en_US or sw." };
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: "audience.template" }, update: { value: name }, create: { key: "audience.template", value: name } }),
    prisma.setting.upsert({ where: { key: "audience.templateLang" }, update: { value: lang }, create: { key: "audience.templateLang", value: lang } }),
  ]);
  refresh();
  return { ok: true, message: "Saved." };
}

export async function setSubscriberStatus(id: string, active: boolean): Promise<AudienceState> {
  await requireAdmin();
  // Re-subscribing someone requires their consent, so admins can only unsubscribe.
  if (active) return { error: "Only the subscriber can subscribe again, using their manage link or the subscribe page." };
  await prisma.subscriber.update({ where: { id }, data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() } });
  refresh();
  return { ok: true };
}

// For data-removal requests: deletes the subscriber and their delivery history.
export async function deleteSubscriber(id: string): Promise<AudienceState> {
  await requireAdmin();
  await prisma.subscriber.delete({ where: { id } }).catch(() => null);
  refresh();
  revalidatePath("/approvals");
  return { ok: true };
}
