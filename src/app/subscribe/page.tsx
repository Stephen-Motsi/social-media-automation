import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { COMMON_LOCATIONS, CONSENT_TEXT } from "@/lib/audience";
import { SubscribeForm } from "./forms";

export const dynamic = "force-dynamic";

const BRAND = process.env.BRAND_NAME ?? "Social Automation";
export const metadata: Metadata = { title: `Subscribe · ${BRAND}`, description: "Get adverts you care about on WhatsApp." };

export default async function SubscribePage() {
  const [interests, locations] = await Promise.all([
    prisma.interest.findMany({ orderBy: { name: "asc" } }),
    prisma.subscriber.findMany({ where: { location: { not: null } }, distinct: ["location"], select: { location: true }, take: 50 }),
  ]);
  const suggestions = [...new Set([...COMMON_LOCATIONS, ...locations.map((l) => l.location!)])];

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="glass w-full max-w-lg rounded-[32px] p-6 sm:p-9">
        <p className="text-sm font-medium text-ink-soft">{BRAND}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Offers you choose, on WhatsApp</h1>
        <p className="mt-3 text-ink-soft">
          Pick the topics you care about. We&rsquo;ll only send adverts that match, and you can stop them any time.
        </p>
        <div className="mt-8">
          {interests.length === 0 ? (
            <p className="text-ink-soft">Subscriptions open soon.</p>
          ) : (
            <SubscribeForm
              interests={interests.map((i) => ({ id: i.id, name: i.name }))}
              locations={suggestions}
              consentText={CONSENT_TEXT}
            />
          )}
        </div>
        <p className="mt-8 text-center text-xs text-ink-soft">
          Already subscribed? Message <strong>MANAGE</strong> to us on WhatsApp to change topics.{" "}
          <a href="/login" className="underline-offset-2 hover:underline">
            Staff sign in
          </a>
        </p>
      </div>
    </main>
  );
}
