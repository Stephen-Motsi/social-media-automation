import type { Channel } from "@prisma/client";
import { prisma } from "@/lib/db";
import { schedulePost } from "@/lib/queue";
import { DEFAULT_TIMEZONE, nextRun, type ScheduleSpec } from "@/lib/schedule";
import { displayHandle, groupOrder, groupPlatforms, handleMatches } from "@/lib/handles";

export const scheduleSpec = (c: Channel): ScheduleSpec => ({
  frequency: c.frequency,
  runAt: c.runAt,
  timeOfDay: c.timeOfDay,
  weekdays: c.weekdays,
  dayOfMonth: c.dayOfMonth,
  timezone: c.timezone,
});

export const computeNextRun = (c: Channel, after = new Date()) => nextRun(scheduleSpec(c), after);

// Creates one post from the channel's advert, targeting every connected account on that platform,
// and queues it for immediate publishing. Used by the scheduler and by "Post now".
export async function runChannel(channelId: string): Promise<string> {
  const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId }, include: { advert: true } });
  if (!channel.advert) throw new Error("No advert chosen for this channel.");

  // Only post to accounts matching the handle set on this social container.
  const accounts = (await prisma.socialAccount.findMany({ where: { platform: channel.platform } })).filter((a) =>
    handleMatches(channel.platform, channel.handle, a),
  );
  if (accounts.length === 0) {
    throw new Error(`No connected account matches ${displayHandle(channel.platform, channel.handle) || "this container"}. Connect it in Settings.`);
  }

  const targets =
    channel.platform === "WHATSAPP"
      ? accounts.flatMap((a) =>
          channel.whatsappRecipients.map((recipient) => ({ accountId: a.id, format: channel.format, recipient })),
        )
      : accounts.map((a) => ({ accountId: a.id, format: channel.format }));
  if (targets.length === 0) throw new Error("Add at least one WhatsApp recipient.");

  const post = await prisma.post.create({
    data: {
      content: channel.advert.content,
      mediaUrls: channel.advert.mediaUrls,
      status: "SCHEDULED",
      scheduledAt: new Date(),
      authorId: channel.advert.authorId,
      channelId: channel.id,
      sourceAdvertId: channel.advert.id,
      targets: { create: targets },
    },
  });
  await schedulePost(post.id);
  return post.id;
}

// Runs every channel whose time has come. Safe with several workers: each run is claimed
// atomically by moving nextRunAt forward before posting. Missed runs (worker was down)
// post once, then continue from the next future time rather than catching up one by one.
export async function runDueChannels(now = new Date()) {
  const due = await prisma.channel.findMany({ where: { enabled: true, nextRunAt: { lte: now } } });
  for (const channel of due) {
    const next = computeNextRun(channel, now);
    const claimed = await prisma.channel.updateMany({
      where: { id: channel.id, nextRunAt: channel.nextRunAt },
      data: { nextRunAt: next, lastRunAt: now, enabled: next !== null },
    });
    if (claimed.count !== 1) continue;
    try {
      await runChannel(channel.id);
      await prisma.channel.update({ where: { id: channel.id }, data: { lastError: null } });
    } catch (err) {
      await prisma.channel.update({
        where: { id: channel.id },
        data: { lastError: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  return due.length;
}

// Every platform always has its container: Meta (Facebook, Instagram, WhatsApp), X and TikTok.
// Missing ones are created without a handle; the admin types the handle to connect it.
export async function ensureAllContainers() {
  const groups = await prisma.channelGroup.findMany({ include: { channels: { select: { platform: true } } } });
  for (const kind of groupOrder) {
    let group = groups.find((g) => g.kind === kind);
    if (!group) group = { ...(await prisma.channelGroup.upsert({ where: { kind }, update: {}, create: { kind } })), channels: [] };
    for (const platform of groupPlatforms[kind]) {
      if (group.channels.some((c) => c.platform === platform)) continue;
      await prisma.channel
        .create({ data: { platform, groupId: group.id, timezone: DEFAULT_TIMEZONE } })
        .catch(() => null); // created at the same moment by another request
    }
  }
}
