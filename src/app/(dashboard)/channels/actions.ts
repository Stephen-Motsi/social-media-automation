"use server";

import { revalidatePath } from "next/cache";
import { reasonFor } from "@/lib/errors";
import { z } from "zod";
import type { GroupKind, Platform } from "@prisma/client";
import { AccessError, requireStaff } from "@/lib/session";
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
import {
  displayHandle,
  groupNames,
  groupOrder,
  groupPlatforms,
  handleMatches,
  normalizeHandle,
  profileUrl,
  validateHandle,
} from "@/lib/handles";
import { DEFAULT_TIMEZONE, formatInZone, parseLocalDateTime, parseTime } from "@/lib/schedule";

// note: saved, but something after the save can't happen yet (shown as a follow-up, not a failure).
export type ActionState = { ok?: boolean; error?: string; message?: string; note?: string; verdict?: PlatformVerdict } | undefined;

async function requireAdmin() {
  await requireStaff();
}

function refresh() {
  revalidatePath("/channels");
  revalidatePath("/");
}

// ---- Parent containers (Meta, X, TikTok) ------------------------------------------

export type GroupInput = { kind: GroupKind; platforms: Platform[]; handles: Partial<Record<Platform, string>> };

function checkGroupInput({ kind, platforms, handles }: GroupInput): string | null {
  if (!groupOrder.includes(kind)) return "Unknown container type.";
  if (platforms.length === 0) return "Choose at least one platform.";
  if (platforms.some((p) => !groupPlatforms[kind].includes(p))) return "That platform doesn't belong in this container.";
  for (const p of platforms) {
    const problem = validateHandle(p, handles[p] ?? "");
    if (problem) return problem;
  }
  return null;
}

export async function createGroup(input: GroupInput): Promise<ActionState> {
  await requireAdmin();
  const problem = checkGroupInput(input);
  if (problem) return { error: problem };
  if (await prisma.channelGroup.findUnique({ where: { kind: input.kind } })) {
    return { error: `There's already a ${groupNames[input.kind]} container.` };
  }
  await prisma.channelGroup.create({
    data: {
      kind: input.kind,
      channels: {
        create: input.platforms.map((platform) => ({
          platform,
          handle: normalizeHandle(platform, input.handles[platform]),
          timezone: DEFAULT_TIMEZONE,
        })),
      },
    },
  });
  refresh();
  return { ok: true };
}

// Edit a container's platforms and handles. Removing a platform deletes its social container
// and disconnects its accounts; changing a handle unlinks accounts that no longer match it.
export async function updateGroup(groupId: string, input: Omit<GroupInput, "kind">): Promise<ActionState> {
  await requireAdmin();
  const group = await prisma.channelGroup.findUnique({ where: { id: groupId }, include: { channels: true } });
  if (!group) return { error: "This container no longer exists." };
  const problem = checkGroupInput({ kind: group.kind, ...input });
  if (problem) return { error: problem };

  const removed = group.channels.filter((c) => !input.platforms.includes(c.platform));
  for (const c of removed) {
    await prisma.$transaction([
      prisma.channel.delete({ where: { id: c.id } }),
      prisma.socialAccount.deleteMany({ where: { platform: c.platform } }),
    ]);
  }
  let unlinked = 0;
  for (const platform of input.platforms) {
    const handle = normalizeHandle(platform, input.handles[platform]);
    const existing = group.channels.find((c) => c.platform === platform);
    if (!existing) {
      await prisma.channel.create({ data: { platform, handle, groupId, timezone: DEFAULT_TIMEZONE } });
      continue;
    }
    if (existing.handle === handle) continue;
    await prisma.channel.update({ where: { id: existing.id }, data: { handle } });
    const accounts = await prisma.socialAccount.findMany({ where: { platform } });
    const stale = accounts.filter((a) => !handleMatches(platform, handle, a)).map((a) => a.id);
    if (stale.length) unlinked += (await prisma.socialAccount.deleteMany({ where: { id: { in: stale } } })).count;
  }
  refresh();
  return {
    ok: true,
    message: unlinked
      ? `Saved. ${unlinked} connected account${unlinked === 1 ? "" : "s"} didn't match the new handle and ${unlinked === 1 ? "was" : "were"} disconnected.`
      : "Saved.",
  };
}

// Deleting a container stops its schedules and disconnects all of its accounts.
export async function deleteGroup(groupId: string): Promise<ActionState> {
  await requireAdmin();
  const group = await prisma.channelGroup.findUnique({ where: { id: groupId } });
  if (!group) return { ok: true };
  await prisma.$transaction([
    prisma.channelGroup.delete({ where: { id: groupId } }),
    prisma.socialAccount.deleteMany({ where: { platform: { in: groupPlatforms[group.kind] } } }),
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
    // Confirms the ID and token work together, and that it's the number this container names.
    const number = await getWhatsAppNumber(phoneNumberId, accessToken);
    const handle = normalizeHandle("WHATSAPP", number.display_phone_number);
    const channel = await prisma.channel.findUnique({ where: { platform: "WHATSAPP" } });
    if (!handleMatches("WHATSAPP", channel?.handle, { handle, displayName: number.verified_name, externalId: number.id })) {
      return {
        error: `These details are for ${number.display_phone_number}, but this container is for ${displayHandle("WHATSAPP", channel?.handle)}. Use that number's phone number ID, or edit the container.`,
      };
    }
    const displayName = `${number.verified_name} (${number.display_phone_number})`;
    const data = { displayName, accessTokenEncrypted: encrypt(accessToken), handle, profileUrl: profileUrl("WHATSAPP", handle) };
    await prisma.socialAccount.upsert({
      where: { platform_externalId: { platform: "WHATSAPP", externalId: number.id } },
      update: data,
      create: { platform: "WHATSAPP", externalId: number.id, ...data },
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

// Uses the permanent (system-user) token in .env. The backend looks up the phone number ID of the
// number typed in this container, so nothing else needs copying from Meta.
export async function connectWhatsAppFromEnv(): Promise<ActionState> {
  await requireAdmin();
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return { error: "WHATSAPP_ACCESS_TOKEN isn't set in .env." };
  let phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) {
    const channel = await prisma.channel.findUnique({ where: { platform: "WHATSAPP" } });
    if (!channel?.handle) return { error: "Enter the WhatsApp number in Settings first." };
    try {
      const wabaIds = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID
        ? [process.env.WHATSAPP_BUSINESS_ACCOUNT_ID]
        : (await inspectToken(token)).wabaIds;
      const found = await findWhatsAppNumber(wabaIds, token, channel.handle);
      if (!found.number || !found.waba) {
        return {
          error: `That token doesn't include ${displayHandle("WHATSAPP", channel.handle)}.${found.shared.length ? ` It has: ${found.shared.map((n) => n.display_phone_number).join(", ")}.` : ""} Check the number, or give the system user access to it in Meta Business settings.`,
        };
      }
      phoneNumberId = found.number.id;
      await subscribeAppToWaba(found.waba, token);
    } catch (err) {
      if (err instanceof GraphApiError) return { error: `Meta didn't accept the token: ${err.message}` };
      throw err;
    }
  }
  return saveWhatsApp(phoneNumberId, token);
}

// Change one platform's handle from Settings: a phone number, @handle or profile link.
export async function setHandle(channelId: string, value: string): Promise<ActionState> {
  await requireAdmin();
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return { error: "This container no longer exists." };
  const problem = validateHandle(channel.platform, value);
  if (problem) return { error: problem };
  const handle = normalizeHandle(channel.platform, value);
  if (handle === channel.handle) return { ok: true, message: "No change." };
  await prisma.channel.update({ where: { id: channel.id }, data: { handle } });
  // Accounts that don't belong to the new handle are unlinked, so nothing posts to the wrong account.
  const stale = (await prisma.socialAccount.findMany({ where: { platform: channel.platform } }))
    .filter((a) => !handleMatches(channel.platform, handle, a))
    .map((a) => a.id);
  if (stale.length) await prisma.socialAccount.deleteMany({ where: { id: { in: stale } } });
  refresh();
  return {
    ok: true,
    message: `Saved ${displayHandle(channel.platform, handle)}.${stale.length ? " The previously connected account didn't match, so it was disconnected." : ""} Now connect it below.`,
  };
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
    return `connect ${who}: in this container's Settings, choose "Connect with a phone number ID and token" and enter the Phone number ID and a permanent access token from your Meta app (WhatsApp → API Setup).`;
  }
  if (platform === "FACEBOOK" || platform === "INSTAGRAM") {
    return `connect ${who}: in this container's Settings, press "Connect Facebook & Instagram" and sign in as an admin of that Page. This needs META_APP_ID and META_APP_SECRET in .env.`;
  }
  return `connect ${who}: in this container's Settings, press Connect and sign in as ${who}.`;
}
