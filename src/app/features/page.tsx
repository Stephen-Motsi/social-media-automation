import type { Metadata } from "next";
import Link from "next/link";
import { PublicPageShell } from "@/components/public-page-shell";

export const metadata: Metadata = { title: "Features | Social Automation", description: "Explore social advert creation, scheduling, publishing and campaign management features." };

const features = [
  { n: "01", title: "AI-assisted advert creation", text: "Create platform-specific advert variants from a campaign brief, with deterministic copy and image composition tools.", status: "Implemented" },
  { n: "02", title: "Scheduling and automation", text: "Configure channel frequency, run schedules, and queue posts through the existing worker and publishing workflow.", status: "Implemented" },
  { n: "03", title: "Campaign management", text: "Save drafts, organise content, review approvals, and manage listed adverts from the admin workspace.", status: "Implemented" },
  { n: "04", title: "Publishing workflow", text: "Publish or schedule content across connected platform accounts, with per-target status and failure details.", status: "Integration-dependent" },
  { n: "05", title: "Audience subscriptions", text: "Collect audience interests, manage subscribers and WhatsApp consent, and control advert subscriptions.", status: "Implemented" },
  { n: "06", title: "Cross-platform analytics", text: "A richer unified analytics layer, attribution, and downloadable reports are planned for future releases.", status: "Planned" },
];

export default function FeaturesPage() {
  return (
    <PublicPageShell>
      <section className="public-page-hero">
        <p className="public-eyebrow"><span /> Product capabilities</p>
        <h1>One workspace.<br /><span>Every campaign in motion.</span></h1>
        <p>Plan, create, approve and publish social advertising without losing context between tools.</p>
      </section>
      <section className="public-feature-grid" aria-label="Platform features">
        {features.map((feature) => (
          <article className="public-feature-card" key={feature.n}>
            <div className="public-card-top"><span>{feature.n}</span><small>{feature.status}</small></div>
            <h2>{feature.title}</h2>
            <p>{feature.text}</p>
          </article>
        ))}
      </section>
      <div className="public-page-cta"><div><p>Ready to centralise your campaigns?</p><h2>Move from idea to published content.</h2></div><Link href="/login?mode=signup">Get Started <span>↗</span></Link></div>
    </PublicPageShell>
  );
}
