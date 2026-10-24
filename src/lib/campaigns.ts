import { prisma } from "@/lib/db";
import {
  CONSENT_TEXT,
  newManageToken,
  proposeAll,
  getAudienceTemplate,
  manageUrl,
  MIN_HOURS_BETWEEN_MESSAGES,
  proposeForSubscriber,
  subscribePageUrl,
  templateText,
} from "@/lib/audience";
import { evaluateSubscription } from "@/lib/policy/subscriptions";
import { handleMatches } from "@/lib/handles";
import { loadImage } from "@/lib/media";
import { sendTemplate, sendText } from "@/lib/meta/whatsapp";
import { reviewContent } from "@/lib/policy/review";
import { accessTokenFor } from "@/lib/tokens";

// Sends an approved campaign to its subscribers over WhatsApp (run by the worker).
// Template expected: optional IMAGE header, body with {{1}} = subscriber's first name and {{2}} = advert text.
export async function sendCampaign(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { advert: true, deliveries: { where: { status: "PENDING" }, include: { subscriber: true } } },
  });
  if (!campaign || !["APPROVED", "SENDING"].includes(campaign.status)) return;
  // Never early (the scheduler's safety net queues it again when it's due).
  if (campaign.sendAt && campaign.sendAt.getTime() > Date.now() + 5_000) return;
  const fail = (error: string) => prisma.campaign.update({ where: { id: campaignId }, data: { status: "FAILED", error } });

  const template = await getAudienceTemplate();
  if (!template) return fail("No WhatsApp template set. Add one on the Audience page.");

  const channel = await prisma.channel.findUnique({ where: { platform: "WHATSAPP" } });
  const account = (await prisma.socialAccount.findMany({ where: { platform: "WHATSAPP" } })).find((a) =>
    handleMatches("WHATSAPP", channel?.handle, a),
  );
  if (!account) return fail("No WhatsApp number connected. Connect it in the Meta container on Channels.");

  // Same rule as everywhere else: check the advert against WhatsApp's rules right before sending.
  const advert = campaign.advert;
  const image = advert.mediaUrls[0] ? await loadImage(advert.mediaUrls[0]).catch(() => null) : null;
  const { verdicts } = await reviewContent({ caption: advert.content, image }, ["WHATSAPP"]);
  const blockers = verdicts[0].issues.filter((i) => i.severity === "block");
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "SENDING", checks: verdicts } });
  if (blockers.length) return fail(`Blocked by policy check: ${blockers.map((b) => b.message).join(" ")}`);

  const token = await accessTokenFor(account);
  const cutoff = new Date(Date.now() - MIN_HOURS_BETWEEN_MESSAGES * 60 * 60 * 1000);
  for (const d of campaign.deliveries) {
    const sub = d.subscriber;
    if (sub.status !== "ACTIVE") {
      await prisma.delivery.update({ where: { id: d.id }, data: { status: "SKIPPED", error: "Unsubscribed" } });
      continue;
    }
    if (sub.lastSentAt && sub.lastSentAt > cutoff) {
      // Not "reached", so the next proposal picks them up again after the gap.
      await prisma.delivery.update({
        where: { id: d.id },
        data: { status: "SKIPPED", error: `Already messaged in the last ${MIN_HOURS_BETWEEN_MESSAGES} hours` },
      });
      continue;
    }
    try {
      const res = await sendTemplate({
        phoneNumberId: account.externalId,
        accessToken: token,
        to: sub.phone,
        templateName: template.name,
        languageCode: template.lang,
        components: [
          ...(advert.mediaUrls[0] ? [{ type: "header", parameters: [{ type: "image", image: { link: advert.mediaUrls[0] } }] }] : []),
          {
            type: "body",
            parameters: [
              { type: "text", text: templateText(sub.name.split(" ")[0] || sub.name, 60) },
              { type: "text", text: templateText(advert.content) },
            ],
          },
        ],
      });
      await prisma.$transaction([
        prisma.delivery.update({
          where: { id: d.id },
          data: { status: "SENT", externalId: res.messages[0].id, sentAt: new Date(), error: null },
        }),
        prisma.subscriber.update({ where: { id: sub.id }, data: { lastSentAt: new Date() } }),
      ]);
    } catch (err) {
      await prisma.delivery.update({
        where: { id: d.id },
        data: { status: "FAILED", error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "SENT" } });
}

// WhatsApp webhooks from subscribers:
// - "JOIN <code>" from the number that signed up confirms ownership, then the automatic checks decide
// - "MANAGE" / "MENU" replies with their manage link
// - "STOP" (and similar) unsubscribes
// - message statuses update deliveries
// Replies are free-form text, allowed because the person just messaged us (24-hour window).
type WhatsAppChange = {
  metadata?: { phone_number_id?: string };
  messages?: { from: string; type: string; text?: { body: string }; button?: { text: string } }[];
  statuses?: { id: string; status: string; errors?: { title?: string; message?: string }[] }[];
};
const STOP_WORDS = /^\s*(stop|unsubscribe|stop all|cancel|end|quit)\s*$/i;
const JOIN = /^\s*join\s*([a-z0-9]{6})?\s*$/i;
const MANAGE = /^\s*(manage|menu|settings|my subscription)\s*$/i;

async function replier() {
  const channel = await prisma.channel.findUnique({ where: { platform: "WHATSAPP" } });
  const account = (await prisma.socialAccount.findMany({ where: { platform: "WHATSAPP" } })).find((a) =>
    handleMatches("WHATSAPP", channel?.handle, a),
  );
  if (!account) return async () => {};
  const token = await accessTokenFor(account);
  return async (to: string, body: string) => {
    await sendText({ phoneNumberId: account.externalId, accessToken: token, to, body }).catch((err) =>
      console.error("WhatsApp reply failed:", err instanceof Error ? err.message : err),
    );
  };
}

// Links a confirmed WhatsApp number to a user account. JOIN from the number is itself the opt-in.
async function linkUserNumber(userId: string, phone: string, reply: (to: string, body: string) => Promise<void>) {
  const existing = await prisma.subscriber.findUnique({ where: { phone } });
  if (existing?.userId && existing.userId !== userId) {
    await reply(phone, "This number is already linked to another account.");
    return;
  }
  const consent = { consentText: CONSENT_TEXT, consentAt: new Date(), confirmedAt: new Date(), userId };
  const sub = existing
    ? await prisma.subscriber.update({ where: { id: existing.id }, data: { ...consent, ...(existing.status === "UNSUBSCRIBED" || existing.status === "REJECTED" ? { source: "user_account" } : {}) } })
    : await prisma.subscriber.create({
        data: { ...consent, name: (await prisma.user.findUnique({ where: { id: userId } }))?.name ?? "Subscriber", phone, source: "user_account", manageToken: newManageToken() },
      });
  await prisma.user.update({ where: { id: userId }, data: { whatsappCode: null, whatsappPending: null } });
  const status = await evaluateSubscription(sub.id);
  await prisma.activityLog.create({ data: { userId, action: "WHATSAPP_LINKED", detail: { phone: `+${phone}`, status } } });
  if (status === "ACTIVE") {
    await proposeForSubscriber(sub.id).catch(() => null);
    await proposeAll().catch(() => null);
    await reply(phone, `Your WhatsApp is linked. Adverts you subscribe to on WhatsApp will arrive here. Reply STOP to stop them.`);
  } else if (status === "NEEDS_REVIEW") {
    await reply(phone, "Thanks. We're reviewing your number and will start sending adverts once it's approved.");
  } else if (status === "REJECTED") {
    await reply(phone, "Sorry, we can't send adverts to this number.");
  }
}

async function handleIncoming(from: string, text: string, reply: (to: string, body: string) => Promise<void>) {
  const phone = from.replace(/\D/g, "");
  if (STOP_WORDS.test(text)) {
    const res = await prisma.subscriber.updateMany({
      where: { phone, status: { in: ["ACTIVE", "PENDING", "NEEDS_REVIEW"] } },
      data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() },
    });
    if (res.count) await reply(phone, "You've been unsubscribed and won't receive any more adverts from us.");
    return;
  }

  const join = JOIN.exec(text);
  if (join) {
    const code = join[1]?.toUpperCase();
    // A signed-in user linking their number from their dashboard
    const linking = code ? await prisma.user.findUnique({ where: { whatsappCode: code } }) : null;
    if (linking) {
      if (linking.whatsappPending !== phone) {
        await reply(phone, "That code was for a different number. Enter this number in your dashboard to get its own code.");
        return;
      }
      await linkUserNumber(linking.id, phone, reply);
      return;
    }
    const sub = code
      ? await prisma.subscriber.findUnique({ where: { confirmCode: code } })
      : await prisma.subscriber.findFirst({ where: { phone, status: "PENDING", source: "subscribe_page" } });
    if (!sub) {
      await reply(phone, `We couldn't find that sign-up. You can subscribe at ${subscribePageUrl()}`);
      return;
    }
    // The code only confirms the number it was issued to; that's what proves ownership.
    if (sub.phone !== phone) {
      await reply(phone, `That code was for a different number. To subscribe this number, sign up at ${subscribePageUrl()}`);
      return;
    }
    if (!sub.confirmedAt) await prisma.subscriber.update({ where: { id: sub.id }, data: { confirmedAt: new Date() } });
    const status = sub.status === "ACTIVE" ? "ACTIVE" : await evaluateSubscription(sub.id);
    const first = sub.name.split(" ")[0];
    if (status === "ACTIVE") {
      await proposeForSubscriber(sub.id).catch(() => null);
      const topics = (await prisma.subscriber.findUnique({ where: { id: sub.id }, include: { interests: true } }))?.interests
        .map((i) => i.name)
        .join(", ");
      await reply(
        phone,
        `Welcome, ${first}! You're subscribed to adverts about: ${topics}. Change your topics any time: ${manageUrl(sub.manageToken)} . Reply STOP to unsubscribe.`,
      );
    } else if (status === "NEEDS_REVIEW") {
      // Flagged entries may have an abusive name, so don't repeat it back.
      await reply(phone, "Thanks. We're reviewing your subscription and will start sending adverts once it's approved.");
    } else if (status === "REJECTED") {
      await reply(phone, "Sorry, we can't subscribe this number.");
    }
    return;
  }

  if (MANAGE.test(text)) {
    const sub = await prisma.subscriber.findUnique({ where: { phone } });
    await reply(
      phone,
      sub ? `Here's your personal link to change topics or unsubscribe: ${manageUrl(sub.manageToken)}` : `You're not subscribed yet. Sign up at ${subscribePageUrl()}`,
    );
  }
}

export async function processWhatsAppWebhook(payload: { object?: string; entry?: { changes?: { value?: WhatsAppChange }[] }[] }) {
  if (payload.object !== "whatsapp_business_account") return;
  let reply: ((to: string, body: string) => Promise<void>) | null = null;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const m of value.messages ?? []) {
        const text = m.text?.body ?? m.button?.text ?? "";
        reply ??= await replier();
        await handleIncoming(m.from, text, reply);
      }
      for (const s of value.statuses ?? []) {
        const status = s.status === "delivered" ? "DELIVERED" : s.status === "read" ? "READ" : s.status === "failed" ? "FAILED" : null;
        if (!status) continue;
        await prisma.delivery.updateMany({
          where: { externalId: s.id },
          data: { status, ...(status === "FAILED" ? { error: s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? "Failed" } : {}) },
        });
      }
    }
  }
}
