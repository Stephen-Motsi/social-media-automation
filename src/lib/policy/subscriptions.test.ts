// Automatic subscription approval checks. Run with `npm test`.
// Uses subscribers without an IP (no database query) and no OpenAI key (content check falls back).
import type { Subscriber } from "@prisma/client";
import { decide, runSubscriptionChecks } from "@/lib/policy/subscriptions";

let fails = 0;
function expect(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
}

delete process.env.OPENAI_API_KEY;
const base: Subscriber = {
  id: "s1",
  name: "Amina Otieno",
  phone: "254712345678",
  location: "Nairobi",
  status: "PENDING",
  consentText: "I agree…",
  consentAt: new Date(),
  consentIp: null,
  source: "subscribe_page",
  addedById: null,
  userId: null,
  confirmCode: "ABC234",
  confirmedAt: null,
  checks: null,
  decidedAt: null,
  decidedBy: null,
  manageToken: "t",
  unsubscribedAt: null,
  lastSentAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const status = async (over: Partial<Subscriber>) => decide(await runSubscriptionChecks({ ...base, ...over }));
const flagged = async (over: Partial<Subscriber>) =>
  (await runSubscriptionChecks({ ...base, ...over })).filter((c) => c.result !== "pass").map((c) => `${c.code}:${c.result}`);

(async () => {
  expect("self sign-up, not yet confirmed -> waits", await status({}), "PENDING");
  expect("self sign-up, confirmed on WhatsApp -> accepted automatically", await status({ confirmedAt: new Date() }), "ACTIVE");
  expect("admin-added with consent record -> accepted automatically", await status({ source: "admin: Signed up in person (form or in store)" }), "ACTIVE");
  expect("no consent -> rejected", await status({ consentText: "", confirmedAt: new Date() }), "REJECTED");
  expect("invalid number -> rejected", await status({ phone: "12345", confirmedAt: new Date() }), "REJECTED");
  expect("Iran (+98) -> rejected", await flagged({ phone: "989121234567", confirmedAt: new Date() }), ["country:fail"]);
  expect("North Korea (+850) -> rejected", await status({ phone: "8501912345678", confirmedAt: new Date() }), "REJECTED");
  expect("name is a link -> review", await flagged({ name: "www.cheap-loans.example/win", confirmedAt: new Date() }), ["name:review"]);
  expect("name is only digits -> review", await status({ name: "0712345678", confirmedAt: new Date() }), "NEEDS_REVIEW");
  expect(
    "admin re-adding someone who unsubscribed -> review",
    await flagged({ source: "admin: Other: phone call", unsubscribedAt: new Date("2026-10-01") }),
    ["opt_out:review"],
  );
  expect("decide: fail beats review", decide([{ code: "a", label: "", result: "review", detail: "" }, { code: "b", label: "", result: "fail", detail: "" }]), "REJECTED");
  process.exit(fails ? 1 : 0);
})();
