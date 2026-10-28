import type { Metadata } from "next";
import Link from "next/link";
import { PublicPageShell } from "@/components/public-page-shell";

export const metadata: Metadata = { title: "About | Social Automation" };

export default function AboutPage() {
  return (
    <PublicPageShell>
      <section className="public-page-hero public-about-hero">
        <p className="public-eyebrow"><span /> About the platform</p>
        <h1>Advertising,<br /><span>finally in one place.</span></h1>
        <p>Social Automation helps teams create, organise, review and schedule advertising from a central workspace.</p>
      </section>
      <section className="public-about-grid">
        <article><small>01 / Purpose</small><h2>Less switching. More control.</h2><p>Keep briefs, draft copy, platform variants, schedules and publishing status connected instead of scattered across separate tools.</p></article>
        <article><small>02 / Who it helps</small><h2>Built for people running campaigns.</h2><p>Administrators can prepare and manage adverts, connect channels, coordinate approval, and monitor publishing workflows.</p></article>
        <article><small>03 / Value</small><h2>One clear operating view.</h2><p>Centralising campaign work reduces missed steps and makes each platform target’s status easier to understand.</p></article>
      </section>
      <div className="public-page-cta"><div><p>Move your campaigns forward</p><h2>Start with one focused workspace.</h2></div><Link href="/login?mode=signup">Get Started <span>↗</span></Link></div>
    </PublicPageShell>
  );
}
