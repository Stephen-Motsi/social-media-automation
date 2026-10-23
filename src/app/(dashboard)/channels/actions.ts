"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Platform } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { GraphApiError } from "@/lib/meta/graph";
import { getWhatsAppNumber } from "@/lib/meta/oauth";
import { computeNextRun, runChannel } from "@/lib/channels";
import { loadImage } from "@/lib/media";
import { reviewContent } from "@/lib/policy/review";
import { formatSupport, platformOrder, type PlatformVerdict } from "@/lib/policy/rules";
import { DEFAULT_TIMEZONE, formatInZone, parseLocalDateTime, parseTime } from "@/lib/schedule";

export type ActionState = { ok?: boolean; error?: string; message?: string; verdict?: PlatformVerdict } | undefined;

async function requireAdmin() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") throw new Error("Only admins can change channels.");
}

function refresh() {
  revalidatePath("/channels");
  revalidatePath("/");
}

// ---- Parent containers ------------------------------------------------------

export async function createChannel(platform: Platform): Promise<ActionState> {
  await requireAdmin();
  if (!platformOrder.includes(platform)) return { error: "Unknown platform." };
  const exists = await prisma.channel.findUnique({ where: { platform } });
  if (exists) return { error: "That platform already has a container." };
  await prisma.channel.create({ data: { platform, timezone: DEFAULT_TIMEZONE } });
  refresh();
  return { ok: true };
}

// Deleting a container stops its schedule and disconnects its accounts.
export async function deleteChannel(id: string): Promise<ActionState> {
  await requireAdmin();
  const channel = await prisma.channel.findUnique({ where: { id } });
  if (!channel) return { ok: true };
  await prisma.$transaction([
    prisma.channel.delete({ where: { id } }),
    prisma.socialAccount.deleteMany({ where: { platform: channel.platform } }),
  ]);
  refresh();
  return { ok: true };
}

// ---- Settings: connect / disconnect --------------------------------------------

export async function disconnectAccount(id: string): Promise<ActionState> {
  await requireAdmin();
  await prisma.socialAccount.delete({ where: { id } }).catch(() => null);
  refresh();
  return { ok: true };
}

const whatsappSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{5,20}$/, "The phone number ID is the long number under API Setup, not the phone number itself."),
  accessToken: z.string().trim().min(20, "Paste the full access token."),
});

async function saveWhatsApp(phoneNumberId: string, accessToken: string): Promise<ActionState> {
  try {
    // Confirms the ID and token work together before saving anything.
    const number = await getWhatsAppNumber(phoneNumberId, accessToken);
    const displayName = `${number.verified_name} (${number.display_phone_number})`;
    const token = encrypt(accessToken);
    await prisma.socialAccount.upsert({
      where: { platform_externalId: { platform: "WHATSAPP", externalId: number.id } },
      update: { displayName, accessTokenEncrypted: token },
      create: { platform: "WHATSAPP", externalId: number.id, displayName, accessTokenEncrypted: token },
    });
    refresh();
    return { ok: true, message: `Connected ${displayName}.` };
  } catch (err) {
    if (err instanceof GraphApiError) return { error: `Meta didn't accept these details: ${err.message}` };
    throw err;
  }
}

export async function connectWhatsApp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = whatsappSchema.safeParse({
    phoneNumberId: formData.get("phoneNumberId"),
    accessToken: formData.get("accessToken"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  return saveWhatsApp(parsed.data.phoneNumberId, parsed.data.accessToken);
}

// Uses WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN from .env, so the token never touches the browser.
export async function connectWhatsAppFromEnv(): Promise<ActionState> {
  await requireAdmin();
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!id || !token) return { error: "WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN aren't set in .env." };
  return saveWhatsApp(id, token);
}

// ---- Social container: format, advert, schedule ------------------------------------

const scheduleSchema = z
  .object({
    id: z.string().min(1),
    format: z.enum(["POST", "STORY"]),
    advertId: z.string().optional(),
    frequency: z.enum(["ONCE", "DAILY", "WEEKLY", "MONTHLY"]),
    runAt: z.string().optional(),
    timeOfDay: z.string().optional(),
    weekdays: z.array(z.coerce.number().int().min(0).max(6)),
    dayOfMonth: z.coerce.number().int().min(1).max(31).optional(),
    enabled: z.boolean(),
    whatsappRecipients: z.array(z.string()),
    whatsappTemplate: z.string().trim().max(512).optional(),
    whatsappTemplateLang: z.string().trim().max(20).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.frequency === "ONCE" && !v.runAt) ctx.addIssue({ code: "custom", message: "Choose the date and time to post." });
    if (v.frequency !== "ONCE") {
      try {
        parseTime(v.timeOfDay ?? "");
      } catch {
        ctx.addIssue({ code: "custom", message: "Choose a time of day." });
      }
    }
    if (v.frequency === "WEEKLY" && v.weekdays.length === 0) ctx.addIssue({ code: "custom", message: "Choose at least one day of the week." });
    if (v.frequency === "MONTHLY" && !v.dayOfMonth) ctx.addIssue({ code: "custom", message: "Choose a date in the month." });
  });

const optional = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : String(v));

// Checks the chosen advert against this platform's rules for the chosen format.
async function checkAdvert(platform: Platform, format: "POST" | "STORY", advertId: string) {
  const advert = await prisma.post.findUnique({ where: { id: advertId } });
  if (!advert) return null;
  const image = advert.mediaUrls[0] ? await loadImage(advert.mediaUrls[0]).catch(() => null) : null;
  const { verdicts } = await reviewContent({ caption: advert.content, image }, [platform], { [platform]: format });
  return verdicts[0];
}

export async function saveChannel(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = scheduleSchema.safeParse({
    id: formData.get("id"),
    format: formData.get("format"),
    advertId: optional(formData.get("advertId")),
    frequency: formData.get("frequency"),
    runAt: optional(formData.get("runAt")),
    timeOfDay: optional(formData.get("timeOfDay")),
    weekdays: formData.getAll("weekdays"),
    dayOfMonth: optional(formData.get("dayOfMonth")),
    enabled: formData.get("enabled") === "on",
    // One number per line (or comma-separated); spaces, dashes and "+" inside a number are fine
    whatsappRecipients: String(formData.get("whatsappRecipients") ?? "")
      .split(/[\n,;]+/)
      .map((n) => n.replace(/[^\d]/g, ""))
      .filter(Boolean),
    whatsappTemplate: optional(formData.get("whatsappTemplate")),
    whatsappTemplateLang: optional(formData.get("whatsappTemplateLang")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;

  const channel = await prisma.channel.findUnique({ where: { id: v.id } });
  if (!channel) return { error: "This container no longer exists." };
  if (!formatSupport[channel.platform][v.format].supported) {
    return { error: formatSupport[channel.platform][v.format].reason };
  }
  const badNumber = v.whatsappRecipients.find((n) => n.length < 8 || n.length > 15);
  if (badNumber) return { error: `"${badNumber}" doesn't look like a phone number. Use international format, e.g. 254712345678.` };

  const runAt = v.runAt ? parseLocalDateTime(v.runAt, channel.timezone) : null;
  const updated = {
    format: v.format,
    advertId: v.advertId ?? null,
    frequency: v.frequency,
    runAt,
    timeOfDay: v.timeOfDay ?? channel.timeOfDay,
    weekdays: v.weekdays,
    dayOfMonth: v.dayOfMonth ?? null,
    whatsappRecipients: v.whatsappRecipients,
    whatsappTemplate: v.whatsappTemplate ?? null,
    whatsappTemplateLang: v.whatsappTemplateLang ?? "en_US",
  };

  // Turning the schedule on requires something to post, somewhere to post it, and a passing check.
  let verdict: PlatformVerdict | undefined;
  let enabled = v.enabled;
  let problem: string | undefined;
  if (v.advertId) verdict = (await checkAdvert(channel.platform, v.format, v.advertId)) ?? undefined;
  if (enabled) {
    const accounts = await prisma.socialAccount.count({ where: { platform: channel.platform } });
    if (!v.advertId) problem = "Choose an advert before turning the schedule on.";
    else if (accounts === 0) problem = "Connect an account in Settings before turning the schedule on.";
    else if (channel.platform === "WHATSAPP" && v.whatsappRecipients.length === 0) problem = "Add at least one recipient before turning the schedule on.";
    else if (verdict?.status === "block") problem = "This advert can't be posted here. Fix the issues below, or choose another advert.";
    if (problem) enabled = false;
  }

  const nextRunAt = enabled ? computeNextRun({ ...channel, ...updated }) : null;
  if (enabled && !nextRunAt) {
    problem = "That time has already passed. Choose a time in the future.";
    enabled = false;
  }

  await prisma.channel.update({ where: { id: channel.id }, data: { ...updated, enabled, nextRunAt } });
  refresh();

  // "Post now" saves the form first, then posts what's on screen.
  if (formData.get("intent") === "post") {
    if (!v.advertId) return { error: "Saved. Choose an advert to post.", verdict };
    if (verdict?.status === "block") return { error: "Saved, but this advert can't be posted here.", verdict };
    try {
      await runChannel(channel.id);
    } catch (err) {
      return { error: `Saved, but couldn't post: ${err instanceof Error ? err.message : err}`, verdict };
    }
    refresh();
    return { ok: true, verdict, message: "Saved and queued. The result shows here and under Posts in a few seconds." };
  }

  if (problem) return { error: `Saved, but the schedule is off. ${problem}`, verdict };
  return {
    ok: true,
    verdict,
    message: enabled && nextRunAt ? `Saved. Next post: ${formatInZone(nextRunAt, channel.timezone)}.` : "Saved. The schedule is off.",
  };
}
