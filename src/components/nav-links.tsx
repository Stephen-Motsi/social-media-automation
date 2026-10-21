"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { href: "/", label: "Overview" },
  { href: "/create", label: "Create" },
  { href: "/posts", label: "Posts" },
  { href: "/accounts", label: "Accounts" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex min-w-0 gap-1 overflow-x-auto text-sm">
      {nav.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
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
          </Link>
        );
      })}
    </nav>
  );
}
