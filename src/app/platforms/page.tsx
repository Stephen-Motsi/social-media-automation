import type { Metadata } from "next";
import Link from "next/link";
import { PlatformBadge, platformOrder, platforms } from "@/components/platforms";
import { PublicPageShell } from "@/components/public-page-shell";

export const metadata: Metadata = { title: "Platforms | Social Automation" };

export default function PlatformsPage() {
  return (
    <PublicPageShell>
      <section className="public-page-hero">
        <p className="public-eyebrow"><span /> Channel support</p>
        <h1>Built around your<br /><span>social channels.</span></h1>
        <p>Platform models and OAuth publishing code exist for Meta, WhatsApp, X and TikTok. Live delivery depends on account credentials and provider configuration.</p>
      </section>
      <section className="public-platform-grid" aria-label="Supported social platforms">
        {platformOrder.map((platform) => {
          const item = platforms[platform];
          const liveLabel = platform === "FACEBOOK" || platform === "INSTAGRAM" || platform === "WHATSAPP" ? "Integration implemented" : "Integration implemented";
          return <article className="public-platform-card" key={platform}><PlatformBadge platform={platform} size="lg" /><div><h2>{item.name}</h2><p>{liveLabel}</p><small>Requires a configured connected account and valid provider credentials.</small></div></article>;
        })}
      </section>
      <div className="public-note"><strong>Working status:</strong> Publishing workflows and callback routes are implemented in the application. They are not claimed as active until your provider credentials, accounts, permissions and webhooks are configured.</div>
      <div className="public-page-cta"><div><p>Connect your channels</p><h2>Manage connected accounts from the workspace.</h2></div><Link href="/login?mode=signup">Get Started <span>↗</span></Link></div>
    </PublicPageShell>
  );
}
