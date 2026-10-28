import type { Metadata } from "next";
import Link from "next/link";
import { PublicPageShell } from "@/components/public-page-shell";

export const metadata: Metadata = { title: "Pricing | Social Automation" };

export default function PricingPage() {
  return (
    <PublicPageShell>
      <section className="public-page-hero public-pricing-hero">
        <p className="public-eyebrow"><span /> Simple by design</p>
        <h1>Pricing <span>coming soon.</span></h1>
        <p>The platform is still defining plans and billing. No subscription prices are currently published, and existing accounts are not charged through this website.</p>
        <div className="public-pricing-card"><span>EARLY ACCESS</span><h2>Explore the workspace</h2><p>Create an account and use the features available in your current deployment.</p><Link href="/login?mode=signup">Get Started <b>↗</b></Link></div>
      </section>
    </PublicPageShell>
  );
}
