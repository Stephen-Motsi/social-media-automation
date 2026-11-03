"use server";

import { revalidatePath } from "next/cache";
import { reasonFor } from "@/lib/errors";
import { connectByHandle, handleConnect } from "@/lib/connect-by-handle";
import { z } from "zod";
import type { Platform } from "@prisma/client";
import { AccessError, logActivity, requireStaff, requireViewer } from "@/lib/session";
import { generateAdvertImage, refineAdvertImage, type ImageResult } from "@/lib/advert-images";
import { publicMediaUrl } from "@/lib/media";
import { proposeCampaign } from "@/lib/audience";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { GraphApiError } from "@/lib/meta/graph";
import { findWhatsAppNumber, getWhatsAppNumber, inspectToken, subscribeAppToWaba } from "@/lib/meta/oauth";
import { computeNextRun, runChannel } from "@/lib/channels";
import { loadImage } from "@/lib/media";
import { reviewContent } from "@/lib/policy/review";
import { formatSupport, type PlatformVerdict } from "@/lib/policy/rules";
import { displayHandle, handleMatches, normalizeHandle, profileUrl, validateHandle } from "@/lib/handles";
import { formatInZone, parseLocalDateTime, parseTime } from "@/lib/schedule";
import { decrypt } from "@/lib/crypto";
import {
  normalizeWahaPhoneNumber, wahaConfigured, testWahaConnection, type WahaConnectionTest,
} from "@/lib/waha";
import {
  connectWahaSession,
  deleteWahaSession as deleteManagedWahaSession,
  disconnectWahaSession,
  getWahaView,
  reconnectWahaSession,
  requestWahaPairingCode,
} from "@/lib/waha-lifecycle";

// note: saved, but something after the save can't happen yet (shown as a follow-up, not a failure).
export type ActionState = { ok?: boolean; error?: string; message?: string; note?: string; verdict?: PlatformVerdict } | undefined;

async function requireAdmin() {
  return requireStaff();
}

// Admin changes to connected accounts go in the activity log (shown on Logs).
const logAdmin = (userId: string, action: string, detail: Record<string, unknown>) => logActivity(userId, action, detail).catch(() => null);

function refresh() {
  revalidatePath("/channels");
  revalidatePath("/");
}

export type WahaConfigurationView = {
  configured: boolean;
  saved: boolean;
  baseUrl: string | null;
  apiKeyConfigured: boolean;
};

export async function testWahaConfigurationAction(input: { baseUrl: string; apiKey?: string }): Promise<WahaConnectionTest & { ok?: boolean }> {
  await requireAdmin();
  const baseUrlInput = input.baseUrl.trim();
  const existing = await prisma.wahaConfiguration.findUnique({ where: { id: "default" } });
  const apiKey = input.apiKey?.trim() || (existing ? decrypt(existing.apiKeyEncrypted) : "");
  if (!baseUrlInput) return { reachable: false, authenticated: false, version: null, message: "Enter the WAHA server address first." };
  if (!apiKey) return { reachable: false, authenticated: false, version: null, message: "Enter the WAHA API Key first." };
  let baseUrl: URL;
  try { baseUrl = new URL(baseUrlInput); } catch {
    return { reachable: false, authenticated: false, version: null, message: "Enter a valid HTTP or HTTPS WAHA server address." };
  }
  if (!["http:", "https:"].includes(baseUrl.protocol) || !baseUrl.hostname) {
    return { reachable: false, authenticated: false, version: null, message: "Enter a valid HTTP or HTTPS WAHA server address." };
  }
  const result = await testWahaConnection(baseUrl.toString().replace(/\/$/, ""), apiKey);
  return { ...result, ok: result.reachable && result.authenticated };
}

export async function getWahaConfigurationAction(): Promise<WahaConfigurationView> {
  await requireAdmin();
  const saved = await prisma.wahaConfiguration.findUnique({ where: { id: "default" } });
  if (!saved) return { configured: false, saved: false, baseUrl: null, apiKeyConfigured: false };
  return {
    configured: true,
    saved: true,
    baseUrl: saved.baseUrl,
    apiKeyConfigured: true,
  };
}

export async function saveWahaConfigurationAction(input: { baseUrl: string; apiKey?: string }): Promise<WahaConfigurationView & ActionState> {
  const admin = await requireAdmin();
  const baseUrlInput = input.baseUrl.trim();
  if (!baseUrlInput) return { configured: false, saved: false, baseUrl: null, apiKeyConfigured: false, error: "WAHA Base URL is required." };
  let baseUrl: URL;
  try {
    baseUrl = new URL(baseUrlInput);
  } catch {
    return { configured: false, saved: false, baseUrl: null, apiKeyConfigured: false, error: "Enter a valid HTTP or HTTPS WAHA Base URL." };
  }
  if (!["http:", "https:"].includes(baseUrl.protocol) || !baseUrl.hostname) {
    return { configured: false, saved: false, baseUrl: null, apiKeyConfigured: false, error: "WAHA Base URL must be a valid HTTP or HTTPS URL." };
  }
  const normalizedBaseUrl = baseUrl.toString().replace(/\/$/, "");

  const existing = await prisma.wahaConfiguration.findUnique({ where: { id: "default" } });
  const apiKey = input.apiKey?.trim() || (existing ? decrypt(existing.apiKeyEncrypted) : "");
  if (!apiKey) return { configured: false, saved: false, baseUrl: null, apiKeyConfigured: false, error: "WAHA API Key is required." };
  if (apiKey.length < 8) return { configured: existing !== null, saved: existing !== null, baseUrl: existing?.baseUrl ?? null, apiKeyConfigured: existing !== null, error: "WAHA API Key appears invalid or is too short." };

  const test = await testWahaConfigurationAction({ baseUrl: normalizedBaseUrl, apiKey });
  if (!test.ok) {
    return { configured: false, saved: false, baseUrl: normalizedBaseUrl, apiKeyConfigured: false, error: test.message };
  }

  const apiKeyEncrypted = encrypt(apiKey);
  await prisma.wahaConfiguration.upsert({
    where: { id: "default" },
    update: { baseUrl: normalizedBaseUrl, apiKeyEncrypted, updatedById: admin.id },
    create: { id: "default", baseUrl: normalizedBaseUrl, apiKeyEncrypted, updatedById: admin.id },
  });
  await logAdmin(admin.id, "WAHA_CONFIGURATION_SAVED", { baseUrl: normalizedBaseUrl });
  refresh();
  return { configured: true, saved: true, baseUrl: normalizedBaseUrl, apiKeyConfigured: true, ok: true, message: "WAHA configuration saved." };
}

// ---- Containers --------------------------------------------------------------------
// Meta (Facebook, Instagram, WhatsApp), X and TikTok always exist (ensureAllContainers in
// src/lib/channels.ts). Admins set each platform's handle in Settings (setHandle below).

// ---- Settings: connect / disconnect --------------------------------------------

export async function disconnectAccount(id: string): Promise<ActionState> {
  const admin = await requireAdmin();
  const removed = await prisma.socialAccount.delete({ where: { id } }).catch(() => null);
  if (removed) await logAdmin(admin.id, "ACCOUNT_DISCONNECTED", { platform: removed.platform, account: removed.displayName });
  refresh();
  return { ok: true };
}

// Change one platform's handle from Settings: a phone number, @handle or profile link.
export async function setHandle(channelId: string, value: string): Promise<ActionState> {
  const admin = await requireAdmin();
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return { error: "This container no longer exists." };
  const problem = validateHandle(channel.platform, value);
  if (problem) return { error: problem };
  const handle = normalizeHandle(channel.platform, value);
  if (handle === channel.handle) {
    // Same handle: connect it if it isn't yet, rather than doing nothing.
    if (!(await hasMatchingAccount(channel.platform, handle)) && handleConnect(channel.platform).ready) {
      const res = await connectByHandle(channel.platform);
      await logAdmin(admin.id, res.ok ? "ACCOUNT_CONNECTED" : "CONNECT_FAILED", { platform: channel.platform, handle: displayHandle(channel.platform, handle), result: res.ok ? res.message : res.error });
      refresh();
      return res.ok ? { ok: true, message: `${res.message} ✓` } : { ok: true, message: `${displayHandle(channel.platform, handle)} is saved.`, note: `Not connected: ${res.error}` };
    }
    return { ok: true, message: "No change." };
  }
  await prisma.channel.update({ where: { id: channel.id }, data: { handle } });
  // Accounts that don't belong to the new handle are unlinked, so nothing posts to the wrong account.
  const stale = (await prisma.socialAccount.findMany({ where: { platform: channel.platform } }))
    .filter((a) => !handleMatches(channel.platform, handle, a))
    .map((a) => a.id);
  if (stale.length) await prisma.socialAccount.deleteMany({ where: { id: { in: stale } } });
  // Connect straight from the handle when the business's credentials are set up.
  await logAdmin(admin.id, "HANDLE_SET", { platform: channel.platform, handle: displayHandle(channel.platform, handle) });
  const saved = `Saved ${displayHandle(channel.platform, handle)}.${stale.length ? " The previously connected account didn't match, so it was disconnected." : ""}`;
  if (handleConnect(channel.platform).ready) {
    const res = await connectByHandle(channel.platform);
    await logAdmin(admin.id, res.ok ? "ACCOUNT_CONNECTED" : "CONNECT_FAILED", { platform: channel.platform, handle: displayHandle(channel.platform, handle), result: res.ok ? res.message : res.error });
    refresh();
    return res.ok ? { ok: true, message: `${saved} ${res.message} ✓` } : { ok: true, message: saved, note: `Not connected: ${res.error}` };
  }
  refresh();
  return { ok: true, message: saved, note: `To connect it from the handle, ${handleConnect(channel.platform).setup}. Or use the sign-in button below.` };
}

// "Connect" next to a handle: links the account using the business's credentials in .env.
export async function connectHandle(channelId: string): Promise<ActionState> {
  const admin = await requireAdmin();
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return { error: "This container no longer exists." };
  const res = await connectByHandle(channel.platform);
  await logAdmin(admin.id, res.ok ? "ACCOUNT_CONNECTED" : "CONNECT_FAILED", { platform: channel.platform, handle: displayHandle(channel.platform, channel.handle), result: res.ok ? res.message : res.error });
  refresh();
  return res.ok ? { ok: true, message: `${res.message} ✓` } : { error: res.error };
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

// Every outcome says plainly whether it was saved: "Saved ✓" (with a note if posting or the
// schedule has to wait for something) or "Not saved: reason".
export async function saveChannel(prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const res = await saveChannelInner(formData);
    if (res?.error && !res.ok) return { ...res, error: `Not saved: ${res.error.replace(/^./, (c) => c.toLowerCase())}` };
    return res;
  } catch (err) {
    return { error: `Not saved: ${reasonFor(err)}` };
  }
}

const SAVED = "Saved ✓";

async function saveChannelInner(formData: FormData): Promise<ActionState> {
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

  // The advert composed in this social container (prompt/upload + title + caption) is saved with it.
  if (formData.get("advertComposer") === "1") {
    const saved = await saveComposedAdvert(channel, {
      title: String(formData.get("advertTitle") ?? ""),
      about: String(formData.get("advertAbout") ?? ""),
      caption: String(formData.get("advertCaption") ?? ""),
      mediaId: optional(formData.get("advertMediaId")) ?? null,
    }, v.format);
    v.advertId = saved ?? undefined;
  }

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
    const accounts = (await prisma.socialAccount.findMany({ where: { platform: channel.platform } })).filter((a) =>
      handleMatches(channel.platform, channel.handle, a),
    ).length;
    const advert = v.advertId ? await prisma.post.findUnique({ where: { id: v.advertId } }) : null;
    if (!v.advertId) problem = "Create the advert (a photo or a caption) before turning the schedule on.";
    else if (!advert?.title) problem = "Give the advert a title, so users know what they're subscribing to.";
    else if (accounts === 0) problem = `Before turning the schedule on, ${connectHowTo(channel.platform, channel.handle)}`;
    else if (channel.platform === "WHATSAPP" && v.whatsappRecipients.length === 0) problem = "Add at least one recipient before turning the schedule on.";
    else if (verdict?.status === "block") problem = "This advert can't be posted here yet. Fix the issues below, for example by uploading a different photo or creating a new image.";
    if (problem) enabled = false;
  }

  const nextRunAt = enabled ? computeNextRun({ ...channel, ...updated }) : null;
  if (enabled && !nextRunAt) {
    problem = "That time has already passed. Choose a time in the future.";
    enabled = false;
  }

  await prisma.channel.update({ where: { id: channel.id }, data: { ...updated, enabled, nextRunAt } });
  // Scheduling it (or posting it) is what makes the advert appear for users to subscribe to.
  if (enabled && v.advertId) await listForUsers(v.advertId);
  refresh();

  // "Post now" saves the form first, then posts what's on screen.
  if (formData.get("intent") === "post") {
    if (!v.advertId) return { ok: true, message: SAVED, note: "Not posted: create the advert (a photo or a caption) first.", verdict };
    if (verdict?.status === "block") return { ok: true, message: SAVED, note: "Not posted: this advert can't be posted here. See the check below.", verdict };
    if (!(await prisma.post.findUnique({ where: { id: v.advertId } }))?.title) {
      return { ok: true, message: SAVED, note: "Not posted: give the advert a title first, so users know what they're subscribing to.", verdict };
    }
    // Posting needs a connected account for this handle; say exactly how to connect it.
    if (!(await hasMatchingAccount(channel.platform, channel.handle))) {
      return { ok: true, message: SAVED, note: `Not posted yet: to post, ${connectHowTo(channel.platform, channel.handle)}`, verdict };
    }
    try {
      await runChannel(channel.id);
    } catch (err) {
      return { ok: true, message: SAVED, note: `Not posted: ${reasonFor(err)}`, verdict };
    }
    // Listed only once it's actually going out, so users never subscribe to something that can't be delivered.
    await listForUsers(v.advertId);
    refresh();
    return { ok: true, verdict, message: "Saved ✓ Posting now, and it's listed for users to subscribe to. The result shows here and under Posts in a few seconds." };
  }

  if (problem) return { ok: true, message: SAVED, note: `The schedule is off: ${problem}`, verdict };
  return {
    ok: true,
    verdict,
    message:
      enabled && nextRunAt
        ? `Saved ✓ Next post: ${formatInZone(nextRunAt, channel.timezone)}. The advert is listed for users to subscribe to.`
        : "Saved ✓ The schedule is off; turn it on to post automatically.",
  };
}

// ---- The social container's own advert -----------------------------------------------

type ChannelRow = { id: string; platform: Platform; format: "POST" | "STORY"; advertId: string | null };

// Creates the container's advert, or updates the one it already uses. Returns its ID (null if empty).
async function saveComposedAdvert(
  channel: ChannelRow,
  input: { title: string; about: string; caption: string; mediaId: string | null },
  format: "POST" | "STORY",
): Promise<string | null> {
  const viewer = await requireStaff();
  const caption = input.caption.trim();
  const asset = input.mediaId ? await prisma.mediaAsset.findUnique({ where: { id: input.mediaId } }) : null;
  const usableAsset = asset && !asset.blocked ? asset : null;
  if (!caption && !usableAsset && !input.title.trim()) return channel.advertId;

  const { verdicts } = await reviewContent({ caption, image: usableAsset, prompt: usableAsset?.prompt ?? undefined }, [channel.platform], {
    [channel.platform]: format,
  });
  const existing = channel.advertId
    ? await prisma.post.findFirst({ where: { id: channel.advertId, status: "DRAFT", channelId: null } })
    : null;
  const data = {
    title: input.title.trim().slice(0, 120) || null,
    about: input.about.trim().slice(0, 500) || null,
    content: caption,
    mediaUrls: usableAsset ? [publicMediaUrl(usableAsset.id)] : [],
  };
  if (existing) {
    const others = ((existing.checks as PlatformVerdict[] | null) ?? []).filter((c) => c.platform !== channel.platform);
    await prisma.post.update({
      where: { id: existing.id },
      data: {
        ...data,
        checks: [...others, ...verdicts],
        targetPlatforms: existing.targetPlatforms.includes(channel.platform) ? existing.targetPlatforms : [...existing.targetPlatforms, channel.platform],
      },
    });
    return existing.id;
  }
  const post = await prisma.post.create({
    data: { ...data, status: "DRAFT", checks: verdicts, targetPlatforms: [channel.platform], authorId: viewer.id },
  });
  return post.id;
}

async function listForUsers(advertId: string) {
  const advert = await prisma.post.findUnique({ where: { id: advertId } });
  if (!advert || advert.listedAt || !advert.title) return;
  await prisma.post.update({ where: { id: advertId }, data: { listedAt: new Date() } });
  await proposeCampaign(advertId, "Advert listed").catch(() => null);
  revalidatePath("/");
  revalidatePath("/me");
  revalidatePath("/admin/adverts");
}

async function channelFor(channelId: string) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) throw new AccessError("This container no longer exists.");
  return channel;
}

export async function generateForChannel(channelId: string, prompt: string, caption: string): Promise<ImageResult> {
  const viewer = await requireStaff();
  const channel = await channelFor(channelId);
  return generateAdvertImage(viewer.id, prompt, channel.platform, channel.format, caption);
}

export async function refineForChannel(channelId: string, mediaId: string, instruction: string, caption: string): Promise<ImageResult> {
  const viewer = await requireStaff();
  const channel = await channelFor(channelId);
  return refineAdvertImage(viewer.id, mediaId, instruction, channel.platform, channel.format, caption);
}

async function hasMatchingAccount(platform: Platform, handle: string | null) {
  return (await prisma.socialAccount.findMany({ where: { platform } })).some((a) => handleMatches(platform, handle, a));
}

// What the admin needs to do to connect this container's account.
function connectHowTo(platform: Platform, handle: string | null) {
  const who = displayHandle(platform, handle) || "the account";
  if (platform === "WHATSAPP") {
    return `connect ${who}: in this container's Settings, press Connect next to the number.`;
  }
  if (platform === "FACEBOOK" || platform === "INSTAGRAM") {
    return `connect ${who}: in this container's Settings, press Connect next to the handle (or sign in with Facebook as an admin of that Page).`;
  }
  return `connect ${who}: in this container's Settings, press Connect next to the handle (or sign in as ${who}).`;
}

export type WahaViewState = {
  status: string;
  sessionName: string | null;
  account: string | null;
  phone: string | null;
  qr: string | null;
  qrExpiresAt?: string | null;
  pairingMismatch?: boolean;
  authMethod?: "QR" | "PHONE";
  pairingCode?: string | null;
  pairingCodeExpiresAt?: string | null;
  error?: string;
};

export async function getWahaStatusAction(): Promise<WahaViewState> {
  const viewer = await requireViewer();
  return getWahaView(viewer.id);
}

export async function refreshWahaQrAction(): Promise<WahaViewState> {
  const viewer = await requireViewer();
  await prisma.whatsappSession.updateMany({
    where: { userId: viewer.id },
    data: { qrGeneratedAt: null, qrExpiresAt: null, qrData: null },
  });
  return getWahaView(viewer.id);
}

export async function setWahaAuthMethodAction(method: "QR" | "PHONE"): Promise<WahaViewState> {
  const viewer = await requireViewer();
  await prisma.whatsappSession.updateMany({
    where: { userId: viewer.id },
    data: method === "QR"
      ? {
          authMethod: "QR",
          pairingCode: null,
          pairingCodeRequestedAt: null,
          pairingCodeExpiresAt: null,
        }
      : {
          authMethod: "PHONE",
          qrGeneratedAt: null,
          qrExpiresAt: null,
          qrData: null,
        },
  });
  return getWahaView(viewer.id);
}

export async function createWahaSessionAction(phoneNumber?: string): Promise<WahaViewState> {
  const viewer = await requireViewer();
  if (!(await wahaConfigured())) return { status: "NOT_CONFIGURED", sessionName: null, account: null, phone: null, qr: null, error: "Save the WAHA Base URL and API Key in Channels before creating a session." };
  if (phoneNumber !== undefined) {
    try {
      normalizeWahaPhoneNumber(phoneNumber);
    } catch (err) {
      return { status: "NOT_CONFIGURED", sessionName: null, account: null, phone: null, qr: null, error: err instanceof Error ? err.message : "Enter a valid WhatsApp phone number." };
    }
  }
  try {
    return await connectWahaSession(viewer.id, phoneNumber);
  } catch (err) {
    return { status: "CONNECTION_ERROR", sessionName: null, account: null, phone: phoneNumber ?? null, qr: null, error: err instanceof Error ? err.message : "Could not start the WhatsApp session." };
  }
}

export async function reconnectWahaSessionAction(phoneNumber?: string): Promise<WahaViewState> {
  const viewer = await requireViewer();
  if (phoneNumber !== undefined) {
    try {
      normalizeWahaPhoneNumber(phoneNumber);
    } catch (err) {
      return { status: "CONNECTION_ERROR", sessionName: null, account: null, phone: null, qr: null, error: err instanceof Error ? err.message : "Enter a valid WhatsApp phone number." };
    }
  }
  try {
    return await reconnectWahaSession(viewer.id, phoneNumber);
  } catch (err) {
    return { status: "CONNECTION_ERROR", sessionName: null, account: null, phone: phoneNumber ?? null, qr: null, error: err instanceof Error ? err.message : "Could not reconnect the WhatsApp session." };
  }
}

export async function requestWahaPairingCodeAction(phoneNumber: string): Promise<WahaViewState> {
  const viewer = await requireViewer();
  try {
    const normalizedPhone = normalizeWahaPhoneNumber(phoneNumber);
    return await requestWahaPairingCode(viewer.id, normalizedPhone);
  } catch (err) {
    return {
      status: "CONNECTION_ERROR",
      sessionName: null,
      account: null,
      phone: phoneNumber ?? null,
      qr: null,
      authMethod: "PHONE",
      error: err instanceof Error ? err.message : "Enter a valid international WhatsApp phone number.",
    };
  }
}

export async function disconnectWahaSessionAction(): Promise<WahaViewState> {
  const viewer = await requireViewer();
  const result = await disconnectWahaSession(viewer.id);
  await logAdmin(viewer.id, "WHATSAPP_DISCONNECTED", { session: result.sessionName });
  refresh();
  return result;
}

export async function deleteWahaSessionAction(): Promise<WahaViewState> {
  const viewer = await requireViewer();
  const existing = await prisma.whatsappSession.findUnique({ where: { userId: viewer.id } });
  if (existing) {
    await logAdmin(viewer.id, "WHATSAPP_SESSION_DELETED", { session: existing.sessionName });
  }
  const result = await deleteManagedWahaSession(viewer.id);
  refresh();
  return result;
}
