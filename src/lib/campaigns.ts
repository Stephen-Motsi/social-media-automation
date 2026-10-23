import { prisma } from "@/lib/db";
import { getAudienceTemplate, MIN_HOURS_BETWEEN_MESSAGES, templateText } from "@/lib/audience";
import { handleMatches } from "@/lib/handles";
import { loadImage } from "@/lib/media";
import { sendTemplate } from "@/lib/meta/whatsapp";
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

// WhatsApp webhooks: "STOP" unsubscribes; message statuses update deliveries.
type WhatsAppChange = {
  messages?: { from: string; type: string; text?: { body: string }; button?: { text: string } }[];
  statuses?: { id: string; status: string; errors?: { title?: string; message?: string }[] }[];
};
const STOP_WORDS = /^\s*(stop|unsubscribe|stop all|cancel|end|quit)\s*$/i;

export async function processWhatsAppWebhook(payload: { object?: string; entry?: { changes?: { value?: WhatsAppChange }[] }[] }) {
  if (payload.object !== "whatsapp_business_account") return;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const m of value.messages ?? []) {
        const text = m.text?.body ?? m.button?.text ?? "";
        if (STOP_WORDS.test(text)) {
          await prisma.subscriber.updateMany({
            where: { phone: m.from.replace(/\D/g, ""), status: "ACTIVE" },
            data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() },
          });
        }
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
