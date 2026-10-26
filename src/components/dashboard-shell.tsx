"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

type Item = { href: string; label: string; icon: string };

const workspace: Item[] = [
  { href: "/admin", label: "Overview", icon: "grid" },
  { href: "/admin/adverts", label: "Adverts", icon: "image" },
  { href: "/create", label: "Create", icon: "plus" },
  { href: "/channels", label: "Channels", icon: "broadcast" },
  { href: "/audience", label: "Audience", icon: "users" },
  { href: "/approvals", label: "Approvals", icon: "check" },
  { href: "/posts", label: "Posts", icon: "calendar" },
];
const administration: Item[] = [
  { href: "/admin/super-admin", label: "Super admin", icon: "shield" },
  { href: "/admin/users", label: "Users", icon: "users" },
  { href: "/admin/roles", label: "Roles", icon: "key" },
  { href: "/admin/logs", label: "Audit logs", icon: "activity" },
];
const titles: Record<string, string> = {
  "/admin": "Overview",
  "/admin/super-admin": "Super admin",
  "/admin/users": "Users",
  "/admin/roles": "Roles",
  "/admin/logs": "Audit logs",
  "/admin/notifications": "Notifications",
  "/admin/adverts": "Adverts",
  "/create": "Create",
  "/channels": "Channels",
  "/audience": "Audience",
  "/approvals": "Approvals",
  "/posts": "Posts",
  "/accounts": "Accounts",
};

export function DashboardShell({
  children,
  email,
  name,
  role,
  unread,
  pendingApprovals,
  signOutAction,
}: {
  children: ReactNode;
  email: string;
  name: string;
  role: string;
  unread: number;
  pendingApprovals: number;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const superAdmin = role === "SUPER_ADMIN";
  const activeTitle = Object.entries(titles)
    .sort(([a], [b]) => b.length - a.length)
    .find(([href]) => (href === "/admin" ? pathname === href : pathname.startsWith(href)))?.[1] ?? "Dashboard";
  const initials = (name || email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");

  const renderItems = (items: Item[]) =>
    items.map((item) => {
      const active = item.href === "/admin" ? pathname === item.href : pathname.startsWith(item.href);
      const badge = item.href === "/approvals" ? pendingApprovals : item.href === "/admin/notifications" ? unread : 0;
      return (
        <Link
          key={item.href}
          href={item.href}
          aria-current={active ? "page" : undefined}
          aria-label={collapsed ? item.label : undefined}
          title={collapsed ? item.label : undefined}
          onClick={() => setMobileOpen(false)}
          className={`group relative flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors ${
            active ? "blend-meta font-medium text-white shadow-md shadow-fuchsia-500/15" : "text-ink-soft hover:bg-white/50 hover:text-ink dark:hover:bg-white/10"
          } ${collapsed ? "md:justify-center md:px-2" : ""}`}
        >
          <Icon name={item.icon} className="size-[18px] shrink-0" />
          <span className={collapsed ? "md:sr-only" : ""}>{item.label}</span>
          {badge > 0 && (
            <span className={`ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${active ? "bg-white/20 text-white" : "bg-danger text-white"} ${collapsed ? "md:hidden" : ""}`}>
              {badge > 99 ? "99+" : badge}
            </span>
          )}
          {badge > 0 && collapsed && <span className="absolute right-2 top-2 size-2 rounded-full bg-danger md:hidden" />}
        </Link>
      );
    });

  return (
    <div className="min-h-screen">
      {mobileOpen && <button type="button" aria-label="Close navigation" className="fixed inset-0 z-30 bg-ink/35 backdrop-blur-sm md:hidden" onClick={() => setMobileOpen(false)} />}
      <aside className={`glass fixed inset-y-0 left-0 z-40 flex w-72 flex-col rounded-none border-y-0 border-l-0 p-4 transition-[width,transform] duration-200 md:w-64 md:translate-x-0 ${collapsed ? "md:w-20" : ""} ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <Link href="/" className={`mb-8 flex h-12 items-center gap-3 px-2 font-semibold tracking-tight ${collapsed ? "md:justify-center md:px-0" : ""}`}>
          <BrandMark />
          <span className={collapsed ? "md:sr-only" : ""}>Social Automation</span>
        </Link>
        <nav aria-label="Main navigation" className="min-h-0 flex-1 space-y-6 overflow-y-auto">
          <div>
            <p className={`mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-soft ${collapsed ? "md:sr-only" : ""}`}>Workspace</p>
            <div className="space-y-1">{renderItems(workspace)}</div>
          </div>
          {superAdmin && (
            <div>
              <p className={`mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-soft ${collapsed ? "md:sr-only" : ""}`}>Administration</p>
              <div className="space-y-1">{renderItems(administration)}</div>
            </div>
          )}
          <div>
            <p className={`mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-soft ${collapsed ? "md:sr-only" : ""}`}>Updates</p>
            <div className="space-y-1">{renderItems([{ href: "/admin/notifications", label: "Notifications", icon: "bell" }])}</div>
          </div>
        </nav>
        <div className={`mt-4 border-t border-line pt-4 ${collapsed ? "md:px-0" : "px-1"}`}>
          <div className={`flex items-center gap-3 rounded-xl bg-white/25 p-2 dark:bg-white/5 ${collapsed ? "md:justify-center" : ""}`}>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white dark:bg-white dark:text-ink">{initials || "SA"}</span>
            <span className={`min-w-0 flex-1 ${collapsed ? "md:hidden" : ""}`}>
              <span className="block truncate text-sm font-medium">{name || email}</span>
              <span className="block truncate text-xs text-ink-soft">{superAdmin ? "Super admin" : "Admin"}</span>
            </span>
            <form action={signOutAction} className={collapsed ? "md:hidden" : ""}>
              <button type="submit" aria-label="Sign out" title="Sign out" className="rounded-lg p-2 text-ink-soft hover:bg-white/50 hover:text-ink dark:hover:bg-white/10">
                <Icon name="logout" className="size-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className={`min-h-screen transition-[padding] duration-200 md:pl-64 ${collapsed ? "md:pl-20" : ""}`}>
        <header className="sticky top-0 z-20 border-b border-line bg-[color-mix(in_srgb,var(--bg)_86%,transparent)] px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-[1600px] items-center gap-3">
            <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open navigation" className="rounded-xl p-2 text-ink-soft hover:bg-white/50 hover:text-ink md:hidden">
              <Icon name="menu" className="size-5" />
            </button>
            <button type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="hidden rounded-xl p-2 text-ink-soft hover:bg-white/50 hover:text-ink md:inline-flex">
              <Icon name="panel" className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="hidden text-xs text-ink-soft sm:block">Workspace <span className="px-1.5">/</span> {activeTitle}</div>
              <h1 className="truncate text-lg font-semibold tracking-tight">{activeTitle}</h1>
            </div>
            <Link href="/admin/notifications" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} className="relative rounded-xl p-2 text-ink-soft hover:bg-white/50 hover:text-ink dark:hover:bg-white/10">
              <Icon name="bell" className="size-5" />
              {unread > 0 && <span className="absolute right-1 top-1 size-2 rounded-full bg-danger ring-2 ring-[var(--bg)]" />}
            </Link>
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl p-1.5 hover:bg-white/50 dark:hover:bg-white/10">
                <span className="flex size-8 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white dark:bg-white dark:text-ink">{initials || "SA"}</span>
                <span className="hidden max-w-44 truncate text-sm font-medium lg:block">{name || email}</span>
                <Icon name="chevron" className="hidden size-4 text-ink-soft lg:block" />
              </summary>
              <div className="glass absolute right-0 mt-2 w-64 rounded-2xl p-3 shadow-xl">
                <p className="truncate px-2 text-sm font-medium">{name || email}</p>
                <p className="truncate px-2 pb-2 text-xs text-ink-soft">{email}</p>
                <p className="border-t border-line px-2 pt-2 text-xs text-ink-soft">{superAdmin ? "Super admin account" : "Admin account"}</p>
                <div className="mt-2 border-t border-line pt-2">
                  <Link href="/me/profile" className="block rounded-lg px-2 py-2 text-sm text-ink-soft hover:bg-white/50 hover:text-ink dark:hover:bg-white/10">Profile settings</Link>
                  <form action={signOutAction}>
                    <button type="submit" className="w-full rounded-lg px-2 py-2 text-left text-sm text-ink-soft hover:bg-white/50 hover:text-ink dark:hover:bg-white/10">Sign out</button>
                  </form>
                </div>
              </div>
            </details>
          </div>
        </header>
        <main className="rise mx-auto max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <span aria-hidden className="relative flex h-6 w-9 shrink-0 items-center">
      <span className="blend-facebook absolute left-0 size-4 rounded-full ring-2 ring-white/70" />
      <span className="blend-instagram absolute left-2.5 size-4 rounded-full ring-2 ring-white/70" />
      <span className="blend-whatsapp absolute left-5 size-4 rounded-full ring-2 ring-white/70" />
    </span>
  );
}

function Icon({ name, className }: { name: string; className: string }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    broadcast: <><path d="M2 12a10 10 0 0 1 20 0M5 12a7 7 0 0 1 14 0M8 12a4 4 0 0 1 8 0M12 12v9" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    check: <><path d="m5 12 4 4L19 6" /><circle cx="12" cy="12" r="10" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
    key: <><circle cx="8" cy="15" r="5" /><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" /></>,
    activity: <><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M10 21h4" /></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
    chevron: <><path d="m6 9 6 6 6-6" /></>,
  };

  return <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.grid}</svg>;
}
