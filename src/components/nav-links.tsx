"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/adverts", label: "Adverts" },
  { href: "/create", label: "Create" },
  { href: "/channels", label: "Channels" },
  { href: "/audience", label: "Audience" },
  { href: "/approvals", label: "Approvals" },
  { href: "/posts", label: "Posts" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/logs", label: "Logs" },
];
const superNav = [{ href: "/admin/roles", label: "Roles" }];

export function NavLinks({ pendingApprovals = 0, superAdmin = false }: { pendingApprovals?: number; superAdmin?: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="flex min-w-0 gap-1 overflow-x-auto text-sm">
      {[...nav, ...(superAdmin ? superNav : [])].map((item) => {
        const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "blend-meta shrink-0 rounded-full px-3 py-1.5 font-medium sm:px-4 text-white shadow-md shadow-fuchsia-500/20"
                : "shrink-0 rounded-full px-3 py-1.5 text-ink-soft sm:px-4 transition-colors hover:bg-white/40 hover:text-ink dark:hover:bg-white/10"
            }
          >
            {item.label}
            {item.href === "/approvals" && pendingApprovals > 0 && (
              <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-xs font-semibold text-white tabular-nums">
                {pendingApprovals}
                <span className="sr-only"> waiting</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
