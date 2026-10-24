import type { Metadata } from "next";
import type { Platform } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isStaff, pageViewer } from "@/lib/session";
import { displayHandle, handleLabels, PROFILE_PLATFORMS, profileUrl } from "@/lib/handles";
import { businessWhatsAppNumber, whatsappLink } from "@/lib/audience";
import { UserHeader } from "../header";
import { WhatsAppLink } from "../widgets";
import { ProfileForm, type ProfileField } from "./form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const viewer = await pageViewer("user");
  const [user, channels, business] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: viewer.id }, include: { socials: true, subscriber: true } }),
    prisma.channel.findMany({ where: { platform: { in: [...PROFILE_PLATFORMS] } } }),
    businessWhatsAppNumber(),
  ]);
  // The business's own account on each platform (where adverts come from / are posted)
  const ours = (p: Platform) => {
    const c = channels.find((ch) => ch.platform === p);
    return c?.handle ? { label: displayHandle(p, c.handle), href: profileUrl(p, c.handle) } : null;
  };
  const how: Record<(typeof PROFILE_PLATFORMS)[number], (o: ReturnType<typeof ours>) => string> = {
    X: (o) => `Sent to you as a direct message${o ? ` from ${o.label}` : ""}. Allow messages from ${o ? o.label : "our account"} (for example, follow it) so it can reach you.`,
    INSTAGRAM: (o) => `We mention you on our post${o ? ` on ${o.label}` : ""}, so it shows in your notifications.`,
    FACEBOOK: () => "Facebook doesn't let businesses message people first, so you'll see it on our Page and in My adverts.",
    TIKTOK: () => "TikTok doesn't let businesses send to people, so you'll see it on our profile and in My adverts.",
  };
  const socials: ProfileField[] = PROFILE_PLATFORMS.map((platform) => {
    const o = ours(platform);
    const mine = user.socials.find((s) => s.platform === platform);
    return {
      platform,
      value: mine ? displayHandle(platform, mine.handle) : "",
      placeholder: handleLabels[platform].placeholder.replace("mangomarket", "yourname"),
      how: how[platform](o),
      delivers: platform === "X" || platform === "INSTAGRAM",
      link: o?.href ? { href: o.href, label: platform === "X" ? `Open ${o.label}` : `See ${o.label}` } : undefined,
    };
  });
  const pendingLink =
    user.whatsappCode && user.whatsappPending
      ? { code: user.whatsappCode, number: user.whatsappPending, link: business ? whatsappLink(business, `JOIN ${user.whatsappCode}`) : null }
      : null;

  return (
    <div className="min-h-screen pb-16">
      <UserHeader email={user.email} current="/me/profile" staff={isStaff(viewer.role)} />
      <main className="rise mx-auto max-w-5xl space-y-8 px-4 pt-10">
        <section>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your profile</h1>
          <p className="mt-2 max-w-prose text-ink-soft">
            Add your socials once. Subscribe to an advert on a platform, and it comes to you there automatically.
          </p>
        </section>
        <section className="glass rounded-3xl p-6" aria-labelledby="wa-h">
          <h2 id="wa-h" className="flex items-center gap-2 text-lg font-semibold">
            WhatsApp
            <span className="rounded-full bg-wa/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">Sent to you</span>
          </h2>
          <p className="mt-1 text-sm text-ink-soft">Adverts arrive on your number. We confirm it&rsquo;s yours with a quick WhatsApp message.</p>
          <div className="mt-3">
            <WhatsAppLink status={user.subscriber ? user.subscriber.status : pendingLink ? "waiting" : "none"} number={user.subscriber?.phone ?? null} pending={pendingLink} />
          </div>
        </section>
        <section className="glass rounded-3xl p-6">
          <ProfileForm name={user.name ?? ""} email={user.email} socials={socials} />
        </section>
      </main>
    </div>
  );
}
