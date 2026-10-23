"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/session";
import { prisma } from "@/lib/db";
import { CONSENT_METHODS, newManageToken, normalizeLocation, normalizePhone, proposeForSubscriber } from "@/lib/audience";
import { evaluateSubscription } from "@/lib/policy/subscriptions";

export type AudienceState = { ok?: boolean; error?: string; message?: string } | undefined;

async function requireAdmin() {
  const v = await requireStaff();
  return { id: v.id, email: v.email };
}

const refresh = () => {
  revalidatePath("/audience");
  revalidatePath("/subscribe");
  revalidatePath("/approvals");
  revalidatePath("/", "layout");
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

// ---- Adding people (admin) ----------------------------------------------------------

export type AddResult =
  | { ok?: boolean; error?: string; message?: string; summary?: { added: number; review: number; rejected: number; skipped: string[] } }
  | undefined;

function consentFields(fd: FormData, adminEmail: string, kind: "admin" | "import") {
  const method = String(fd.get("consentMethod") ?? "");
  const note = String(fd.get("consentNote") ?? "").trim().slice(0, 200);
  if (!CONSENT_METHODS.includes(method as (typeof CONSENT_METHODS)[number])) return { error: "Choose how you got their consent." };
  if (method === "Other" && !note) return { error: "Describe how you got their consent." };
  if (fd.get("attest") !== "on") return { error: "Confirm that they agreed to receive adverts from you on WhatsApp." };
  const how = note ? `${method}: ${note}` : method;
  return {
    data: {
      source: `${kind}: ${how}`,
      consentText: `Added by ${adminEmail}. Consent: ${how}. They agreed to receive adverts on WhatsApp.`,
      consentAt: new Date(),
    },
  };
}

async function addOne(
  input: { name: string; phone: string; location?: string | null; interestIds: string[] },
  consent: { source: string; consentText: string; consentAt: Date },
  adminId: string,
): Promise<"added" | "review" | "rejected" | `skipped:${string}`> {
  const phone = normalizePhone(input.phone);
  if (!phone) return `skipped:${input.phone} isn't a valid number`;
  if (input.name.trim().length < 2) return `skipped:${input.phone} has no name`;
  const existing = await prisma.subscriber.findUnique({ where: { phone } });
  if (existing && ["ACTIVE", "PENDING", "NEEDS_REVIEW"].includes(existing.status)) return `skipped:+${phone} is already on the list`;
  const data = {
    name: input.name.trim().slice(0, 80),
    location: normalizeLocation(input.location),
    ...consent,
    consentIp: null,
    addedById: adminId,
    confirmCode: null,
    confirmedAt: null,
  };
  const sub = existing
    ? await prisma.subscriber.update({ where: { id: existing.id }, data: { ...data, interests: { set: input.interestIds.map((id) => ({ id })) } } })
    : await prisma.subscriber.create({
        data: { ...data, phone, manageToken: newManageToken(), interests: { connect: input.interestIds.map((id) => ({ id })) } },
      });
  // Same automatic checks as self sign-ups, with the admin's consent record instead of WhatsApp confirmation.
  const status = await evaluateSubscription(sub.id);
  if (status === "ACTIVE") await proposeForSubscriber(sub.id).catch(() => null);
  return status === "ACTIVE" ? "added" : status === "REJECTED" ? "rejected" : "review";
}

export async function addSubscriber(_prev: AddResult, fd: FormData): Promise<AddResult> {
  const admin = await requireAdmin();
  const consent = consentFields(fd, admin.email, "admin");
  if ("error" in consent) return { error: consent.error };
  const interestIds = (await prisma.interest.findMany({ where: { id: { in: fd.getAll("interests").map(String) } } })).map((i) => i.id);
  if (interestIds.length === 0) return { error: "Choose at least one topic." };
  const result = await addOne(
    { name: String(fd.get("name") ?? ""), phone: String(fd.get("phone") ?? ""), location: String(fd.get("location") ?? ""), interestIds },
    consent.data,
    admin.id,
  );
  refresh();
  if (result.startsWith("skipped:")) return { error: result.slice(8) };
  return {
    ok: true,
    message:
      result === "added"
        ? "Added and accepted automatically."
        : result === "review"
          ? "Added, but an automatic check flagged it. It's waiting on Approvals."
          : "Not added: it failed an automatic check (see the subscriber list).",
  };
}

// Bulk add: one person per line, "Name, phone, town, Topic; Topic". Town and topics are optional;
// lines without topics get the topics ticked on the form.
export async function importSubscribers(_prev: AddResult, fd: FormData): Promise<AddResult> {
  const admin = await requireAdmin();
  const consent = consentFields(fd, admin.email, "import");
  if ("error" in consent) return { error: consent.error };
  const topics = await prisma.interest.findMany();
  const byName = new Map(topics.map((t) => [t.name.toLowerCase(), t.id]));
  const defaults = fd.getAll("interests").map(String).filter((id) => topics.some((t) => t.id === id));
  const lines = String(fd.get("rows") ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^name\s*,/i.test(l));
  if (lines.length === 0) return { error: "Paste at least one line: Name, phone, town, topics." };
  if (lines.length > 500) return { error: "Add up to 500 people at a time." };

  const summary = { added: 0, review: 0, rejected: 0, skipped: [] as string[] };
  for (const line of lines) {
    const [name = "", phone = "", town = "", topicList = ""] = line.split(",").map((p) => p.trim());
    const named = topicList.split(/[;|]/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    const unknown = named.filter((t) => !byName.has(t));
    const interestIds = named.length ? named.flatMap((t) => (byName.has(t) ? [byName.get(t)!] : [])) : defaults;
    if (unknown.length) {
      summary.skipped.push(`${name || phone}: unknown topic "${unknown.join('", "')}"`);
      continue;
    }
    if (interestIds.length === 0) {
      summary.skipped.push(`${name || phone}: no topics`);
      continue;
    }
    const r = await addOne({ name, phone, location: town, interestIds }, consent.data, admin.id);
    if (r === "added") summary.added++;
    else if (r === "review") summary.review++;
    else if (r === "rejected") summary.rejected++;
    else summary.skipped.push(r.slice(8));
  }
  refresh();
  return { ok: true, summary };
}

// ---- Admin decisions on flagged subscriptions -----------------------------------------

export async function decideSubscriber(id: string, approve: boolean): Promise<AudienceState> {
  const admin = await requireAdmin();
  const sub = await prisma.subscriber.findUnique({ where: { id } });
  if (!sub) return { error: "This subscriber no longer exists." };
  if (sub.status === "UNSUBSCRIBED") return { error: "They unsubscribed; only they can subscribe again." };
  await prisma.subscriber.update({
    where: { id },
    data: { status: approve ? "ACTIVE" : "REJECTED", decidedAt: new Date(), decidedBy: admin.email },
  });
  if (approve) await proposeForSubscriber(id).catch(() => null);
  refresh();
  return { ok: true, message: approve ? "Approved." : "Rejected." };
}

export async function recheckSubscriber(id: string): Promise<AudienceState> {
  await requireAdmin();
  const status = await evaluateSubscription(id);
  if (status === "ACTIVE") await proposeForSubscriber(id).catch(() => null);
  refresh();
  return { ok: true, message: `Checked again: ${status.toLowerCase().replace("_", " ")}.` };
}
