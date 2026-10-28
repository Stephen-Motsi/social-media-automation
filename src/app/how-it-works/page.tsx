import type { Metadata } from "next";
import Link from "next/link";
import { PublicPageShell } from "@/components/public-page-shell";

export const metadata: Metadata = { title: "How It Works | Social Automation" };

const steps = [
  { n: "01", title: "Create an advert", text: "Add your campaign brief, headline, supporting copy and connected account context. Review platform-specific variants before saving." },
  { n: "02", title: "Schedule content", text: "Choose an audience, configure a channel schedule or save a future publication date, and send campaigns through an approval workflow when required." },
  { n: "03", title: "Publish and manage", text: "Track each platform target, review publication results, manage listed adverts, and keep upcoming campaigns visible in the dashboard." },
];

export default function HowItWorksPage() {
  return (
    <PublicPageShell>
      <section className="public-page-hero">
        <p className="public-eyebrow"><span /> The workflow</p>
        <h1>From campaign idea<br /><span>to organised publishing.</span></h1>
        <p>Three connected steps keep creation, scheduling and delivery in one operating view.</p>
      </section>
      <section className="public-steps" aria-label="How the platform works">
        {steps.map((step, index) => (
          <article className="public-step" key={step.n}><div className="public-step-marker"><span>{step.n}</span></div><div><h2>{step.title}</h2><p>{step.text}</p></div>{index < steps.length - 1 && <span className="public-step-arrow" aria-hidden="true">→</span>}</article>
        ))}
      </section>
      <div className="public-page-cta"><div><p>Start with your first campaign</p><h2>Create, schedule, publish.</h2></div><Link href="/login?mode=signup">Get Started <span>↗</span></Link></div>
    </PublicPageShell>
  );
}
