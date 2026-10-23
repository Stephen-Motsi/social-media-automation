import type { Subscriber, SubscriberStatus } from "@prisma/client";
import { moderate } from "@/lib/ai/openai";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/audience";

// Automatic approval of subscriptions, based on WhatsApp's rules for business messaging.
// Sources (re-check when Meta updates them):
// - WhatsApp Business Messaging Policy (opt-in): https://business.whatsapp.com/policy
// - Get opt-in for WhatsApp:                    https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in
// - Meta sanctions / unsupported countries:     https://developers.facebook.com/docs/whatsapp/cloud-api/overview#availability
// These are a product-level starting point, not legal advice.

export type CheckResult = "pass" | "fail" | "review" | "pending";
export type SubscriptionCheck = { code: string; label: string; result: CheckResult; detail: string };

// Countries WhatsApp Business can't message (comprehensive sanctions). Extend with BLOCKED_COUNTRY_CODES.
const SANCTIONED = { "53": "Cuba", "98": "Iran", "850": "North Korea", "963": "Syria" } as Record<string, string>;
const extraBlocked = (process.env.BLOCKED_COUNTRY_CODES ?? "").split(",").map((c) => c.trim()).filter(Boolean);
// Optional: only accept these country codes automatically (others go to review), e.g. "254,255,256"
const allowed = (process.env.ALLOWED_COUNTRY_CODES ?? "").split(",").map((c) => c.trim()).filter(Boolean);

const MAX_SIGNUPS_PER_IP_BEFORE_REVIEW = 3;
export const CONFIRM_WITHIN_DAYS = 7;

// Shown to admins on the Audience page so the automatic rules are transparent.
export const SUBSCRIPTION_RULES: { label: string; policy: string; onFail: string }[] = [
  { label: "Opt-in consent is recorded", policy: "Businesses must get opt-in before messaging someone on WhatsApp", onFail: "Rejected" },
  { label: "The number is a valid phone number", policy: "Messages can only go to real WhatsApp numbers", onFail: "Rejected" },
  { label: "WhatsApp Business can message the country", policy: "Meta doesn't allow business messages to sanctioned countries", onFail: "Rejected" },
  { label: "The person confirmed they own the number", policy: "Opt-in must come from the number's owner (self sign-ups send JOIN on WhatsApp; admin-added people rely on the admin's consent record)", onFail: "Waits for confirmation" },
  { label: "The name passes the content check", policy: "No abusive or offensive entries", onFail: "Admin review" },
  { label: "Not one of many sign-ups from the same network", policy: "Protects against spam and fake sign-ups", onFail: "Admin review" },
  { label: "Not re-added after they unsubscribed", policy: "Opt-outs must be honoured; re-adding needs fresh consent from the person", onFail: "Admin review" },
];

function countryOf(phone: string) {
  for (const len of [3, 2, 1]) {
    const code = phone.slice(0, len);
    if (SANCTIONED[code] || extraBlocked.includes(code)) return { code, blocked: true, name: SANCTIONED[code] ?? `+${code}` };
  }
  return { code: null, blocked: false, name: null };
}

export async function runSubscriptionChecks(sub: Subscriber): Promise<SubscriptionCheck[]> {
  const checks: SubscriptionCheck[] = [];
  const selfSignup = sub.source === "subscribe_page";

  checks.push(
    sub.consentText && sub.consentAt
      ? { code: "consent", label: "Opt-in consent", result: "pass", detail: selfSignup ? "Ticked the consent box on the subscribe page" : `Recorded by admin: ${sub.source.replace(/^(admin|import): ?/, "")}` }
      : { code: "consent", label: "Opt-in consent", result: "fail", detail: "No consent recorded" },
  );

  const validPhone = normalizePhone(sub.phone) === sub.phone;
  checks.push({ code: "phone", label: "Valid number", result: validPhone ? "pass" : "fail", detail: validPhone ? `+${sub.phone}` : "Not a valid phone number" });

  const country = countryOf(sub.phone);
  if (country.blocked) {
    checks.push({ code: "country", label: "Country", result: "fail", detail: `WhatsApp Business can't message numbers in ${country.name}` });
  } else if (allowed.length && !allowed.some((c) => sub.phone.startsWith(c))) {
    checks.push({ code: "country", label: "Country", result: "review", detail: "Outside the countries set in ALLOWED_COUNTRY_CODES" });
  } else {
    checks.push({ code: "country", label: "Country", result: "pass", detail: "WhatsApp Business can message this country" });
  }

  if (selfSignup) {
    checks.push(
      sub.confirmedAt
        ? { code: "ownership", label: "Number ownership", result: "pass", detail: "Confirmed by sending JOIN from this number" }
        : { code: "ownership", label: "Number ownership", result: "pending", detail: "Waiting for the person to send JOIN on WhatsApp" },
    );
  } else {
    checks.push({ code: "ownership", label: "Number ownership", result: "pass", detail: "Consent collected by the business (admin attested)" });
  }

  // Names with links or only digits are a common spam pattern; then an AI content check.
  if (/https?:\/\/|www\.|\.[a-z]{2,}\//i.test(sub.name) || /^\d+$/.test(sub.name.replace(/\s/g, ""))) {
    checks.push({ code: "name", label: "Name", result: "review", detail: "The name looks like a link or a number" });
  } else {
    try {
      const m = await moderate({ text: sub.name });
      checks.push(
        m.flagged
          ? { code: "name", label: "Name", result: "review", detail: `Flagged: ${Object.entries(m.categories).filter(([, v]) => v).map(([k]) => k).join(", ")}` }
          : { code: "name", label: "Name", result: "pass", detail: "Passed the content check" },
      );
    } catch {
      checks.push({ code: "name", label: "Name", result: "pass", detail: "Content check unavailable; basic checks passed" });
    }
  }

  if (selfSignup && sub.consentIp) {
    const sameIp = await prisma.subscriber.count({
      where: { consentIp: sub.consentIp, id: { not: sub.id }, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    checks.push(
      sameIp >= MAX_SIGNUPS_PER_IP_BEFORE_REVIEW
        ? { code: "velocity", label: "Sign-up pattern", result: "review", detail: `${sameIp + 1} sign-ups from the same network in the last hour` }
        : { code: "velocity", label: "Sign-up pattern", result: "pass", detail: "Normal" },
    );
  }

  if (!selfSignup && sub.unsubscribedAt) {
    checks.push({
      code: "opt_out",
      label: "Previous opt-out",
      result: "review",
      detail: `Unsubscribed on ${sub.unsubscribedAt.toISOString().slice(0, 10)}; re-adding needs their fresh consent`,
    });
  }
  return checks;
}

export function decide(checks: SubscriptionCheck[]): SubscriberStatus {
  if (checks.some((c) => c.result === "fail")) return "REJECTED";
  if (checks.some((c) => c.result === "review")) return "NEEDS_REVIEW";
  if (checks.some((c) => c.result === "pending")) return "PENDING";
  return "ACTIVE";
}

// Runs the checks and applies the automatic decision. Returns the new status.
export async function evaluateSubscription(subscriberId: string): Promise<SubscriberStatus> {
  const sub = await prisma.subscriber.findUniqueOrThrow({ where: { id: subscriberId } });
  const checks = await runSubscriptionChecks(sub);
  const status = decide(checks);
  await prisma.subscriber.update({
    where: { id: sub.id },
    data: {
      status,
      checks,
      ...(status === "PENDING" ? { decidedAt: null, decidedBy: null } : { decidedAt: new Date(), decidedBy: "auto" }),
      ...(status === "ACTIVE" ? { unsubscribedAt: null } : {}),
    },
  });
  return status;
}

// Self sign-ups that never confirmed are dropped after CONFIRM_WITHIN_DAYS.
export async function expireUnconfirmed() {
  const cutoff = new Date(Date.now() - CONFIRM_WITHIN_DAYS * 24 * 60 * 60 * 1000);
  const res = await prisma.subscriber.updateMany({
    where: { status: "PENDING", source: "subscribe_page", createdAt: { lt: cutoff } },
    data: { status: "REJECTED", decidedAt: new Date(), decidedBy: "auto (not confirmed in time)" },
  });
  return res.count;
}
