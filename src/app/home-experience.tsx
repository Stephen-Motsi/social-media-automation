"use client";

import Link from "next/link";
import { useState, type MouseEvent } from "react";
import { PlatformBadge } from "@/components/platforms";
import { PublicNavbar } from "@/components/public-navbar";

export function HomeExperience({
  brand,
  dashboard,
}: {
  brand: string;
  dashboard: string | null;
}) {
  const [tab, setTab] = useState<"create" | "calendar" | "publish">("create");
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const primaryHref = dashboard === "/me" ? "#adverts" : dashboard ?? "/login?mode=signup";
  const primaryLabel = dashboard === "/me" ? "Choose adverts" : dashboard ? "Go to admin" : "Get Started";

  function handleParallax(event: MouseEvent<HTMLDivElement>) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: x * 8, y: y * -6 });
  }

  return (
    <div className="home-premium">
      <div className="home-noise" aria-hidden="true" />
      <div className="home-orb home-orb-one" aria-hidden="true" />
      <div className="home-orb home-orb-two" aria-hidden="true" />

      <PublicNavbar brand={brand} dashboard={dashboard} />

      <main className="home-main">
        <section className="home-hero" aria-labelledby="home-title" onMouseMove={handleParallax} onMouseLeave={() => setTilt({ x: 0, y: 0 })}>
          <div className="home-hero-copy">
            <div className="home-eyebrow"><span /> Automation suite <b>01</b></div>
            <h1 id="home-title">
              Your Social Media.<br />
              <span>On Autopilot.</span>
            </h1>
            <p>
              Create, organise, schedule and automate social media adverts from one focused workspace—then keep every campaign moving across your channels.
            </p>
            <div className="home-ctas">
              <Link href={primaryHref} className="home-button home-button-primary">{primaryLabel}<span aria-hidden="true">↗</span></Link>
              <Link href="/features" className="home-button home-button-secondary"><span className="home-play" aria-hidden="true">▶</span>Explore Features</Link>
            </div>
            <div className="home-proof" aria-label="Supported social platforms">
              <div><strong>5</strong><span>platforms supported</span></div>
              <div className="home-proof-icons">
                <PlatformBadge platform="FACEBOOK" size="lg" />
                <PlatformBadge platform="INSTAGRAM" size="lg" />
                <PlatformBadge platform="WHATSAPP" size="lg" />
                <PlatformBadge platform="X" size="lg" />
                <PlatformBadge platform="TIKTOK" size="lg" />
              </div>
            </div>
          </div>

          <div
            className="home-visual"
            style={{ "--tilt-x": `${tilt.x}deg`, "--tilt-y": `${tilt.y}deg` } as React.CSSProperties}
          >
            <div className="home-orbit home-orbit-one" aria-hidden="true"><PlatformBadge platform="INSTAGRAM" /></div>
            <div className="home-orbit home-orbit-two" aria-hidden="true"><PlatformBadge platform="FACEBOOK" /></div>
            <div className="home-orbit home-orbit-three" aria-hidden="true"><PlatformBadge platform="WHATSAPP" /></div>

            <div className="home-floating-card home-floating-left">
              <span className="home-status-dot" />
              <div><small>Campaign</small><strong>Summer launch</strong></div>
              <span className="home-mini-status">Scheduled</span>
            </div>
            <div className="home-floating-card home-floating-right">
              <span className="home-spark" aria-hidden="true">✦</span>
              <div><small>Publishing</small><strong>3 of 3 ready</strong></div>
            </div>

            <div className="home-dashboard-wrap" id="features">
              <div className="home-dashboard-glow" aria-hidden="true" />
              <div className="home-dashboard">
                <div className="home-window-bar">
                  <div><i /><i /><i /></div>
                  <span>Campaign workspace</span>
                  <b>DEMO</b>
                </div>
                <div className="home-dashboard-body">
                  <aside className="home-dashboard-sidebar" aria-label="Demo dashboard navigation">
                    <span className="active" title="Overview">⌂</span>
                    <span title="Create">＋</span>
                    <span title="Calendar">▦</span>
                    <span title="Analytics">⌁</span>
                  </aside>
                  <div className="home-dashboard-content">
                    <div className="home-dashboard-head">
                      <div><small>Workspace</small><strong>Summer campaign</strong></div>
                      <button type="button">New advert <span>＋</span></button>
                    </div>
                    <div className="home-tabs" role="tablist" aria-label="Product preview views">
                      {(["create", "calendar", "publish"] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          role="tab"
                          aria-selected={tab === value}
                          onClick={() => setTab(value)}
                        >
                          {value === "create" ? "Creation" : value === "calendar" ? "Calendar" : "Publishing"}
                        </button>
                      ))}
                    </div>
                    <div className="home-preview-panel" role="tabpanel">
                      {tab === "create" && <CreatePreview />}
                      {tab === "calendar" && <CalendarPreview />}
                      {tab === "publish" && <PublishPreview />}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="home-feature-strip" aria-label="Product highlights">
          <div><span>01</span><strong>Create</strong><p>Turn campaign ideas into polished platform variants.</p></div>
          <div><span>02</span><strong>Organise</strong><p>Keep briefs, audiences and content in one workspace.</p></div>
          <div><span>03</span><strong>Automate</strong><p>Schedule repeatable publishing workflows with clarity.</p></div>
        </section>
      </main>
    </div>
  );
}

function CreatePreview() {
  return (
    <div className="home-create-preview">
      <div className="home-create-image">
        <div className="home-product-orb"><span>SUMMER</span></div>
        <div className="home-image-copy"><small>NEW COLLECTION</small><strong>Make it<br />bright.</strong></div>
      </div>
      <div className="home-create-form">
        <div className="home-field"><small>Campaign brief</small><strong>Weekend product launch</strong></div>
        <div className="home-field"><small>Caption</small><p>Meet the colours made for brighter days.</p></div>
        <div className="home-platform-row"><span><PlatformBadge platform="INSTAGRAM" /></span><span><PlatformBadge platform="FACEBOOK" /></span><span><PlatformBadge platform="WHATSAPP" /></span></div>
        <div className="home-ready"><span>✓</span> Ready for review</div>
      </div>
    </div>
  );
}

function CalendarPreview() {
  const cells = ["", "", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28"];
  return (
    <div className="home-calendar-preview">
      <div className="home-calendar-head"><strong>October 2026</strong><span>Week 3</span></div>
      <div className="home-calendar-grid">
        {cells.map((day, index) => <span key={index} className={day ? "home-day" : ""}>{day}{day === "18" || day === "21" ? <i /> : null}</span>)}
      </div>
      <div className="home-calendar-note"><span /> Demo campaign scheduled for 18 Oct</div>
    </div>
  );
}

function PublishPreview() {
  return (
    <div className="home-publish-preview">
      <div className="home-publish-row"><PlatformBadge platform="INSTAGRAM" /><div><strong>Instagram</strong><span>Scheduled</span></div><i className="done" /></div>
      <div className="home-publish-row"><PlatformBadge platform="FACEBOOK" /><div><strong>Facebook</strong><span>Ready</span></div><i className="done" /></div>
      <div className="home-publish-row"><PlatformBadge platform="WHATSAPP" /><div><strong>WhatsApp</strong><span>Queued</span></div><i /></div>
      <div className="home-publish-footer"><span>Mock publishing workflow</span><strong>2 / 3 complete</strong></div>
    </div>
  );
}
