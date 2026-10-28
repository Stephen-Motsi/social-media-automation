"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const items = [
  { href: "/", label: "Home" },
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/platforms", label: "Platforms" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
];

export function PublicNavbar({ brand, dashboard }: { brand: string; dashboard?: string | null }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [pathname]);
  const active = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="public-navbar-header">
      <nav className="public-navbar" aria-label="Main navigation">
        <Link href="/" className="public-brand" aria-label={`${brand} home`}>
          <span className="public-brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>{brand}</span>
        </Link>

        <div className="public-nav-links">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="public-nav-link"
              aria-current={active(item.href) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>

        <div className="public-nav-actions">
          {dashboard ? (
            <Link href={dashboard} className="public-get-started">{dashboard === "/me" ? "My dashboard" : "Admin"}</Link>
          ) : (
            <>
              <Link href="/login" className="public-sign-in">Sign in</Link>
              <Link href="/login?mode=signup" className="public-get-started">Get Started <span aria-hidden="true">↗</span></Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="public-menu-button"
          aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={mobileOpen}
          aria-controls="public-mobile-menu"
          onClick={() => setMobileOpen((value) => !value)}
        >
          <span /><span />
        </button>
      </nav>

      <div id="public-mobile-menu" className="public-mobile-menu" hidden={!mobileOpen}>
        {items.map((item) => (
          <Link key={item.href} href={item.href} aria-current={active(item.href) ? "page" : undefined}>
            {item.label}<span aria-hidden="true">→</span>
          </Link>
        ))}
        {dashboard ? (
          <Link href={dashboard} className="public-mobile-cta">{dashboard === "/me" ? "My dashboard" : "Admin"}</Link>
        ) : (
          <><Link href="/login">Sign in</Link><Link href="/login?mode=signup" className="public-mobile-cta">Get Started</Link></>
        )}
      </div>
    </header>
  );
}
