import Link from "next/link";
import { signOut } from "@/auth";

const links = [
  { href: "/", label: "Home" },
  { href: "/me", label: "My adverts" },
  { href: "/me/profile", label: "Profile" },
];

// Header for signed-in users' pages.
export function UserHeader({ email, current, staff }: { email: string; current: string; staff: boolean }) {
  return (
    <header className="sticky top-4 z-20 px-4">
      <div className="glass mx-auto flex max-w-5xl items-center gap-1 rounded-full py-2 pr-2 pl-4 sm:gap-2">
        <Link href="/" className="mr-2 hidden font-semibold tracking-tight sm:inline">
          {process.env.BRAND_NAME ?? "Social Automation"}
        </Link>
        <nav className="flex min-w-0 gap-1 overflow-x-auto text-sm">
          {[...links, ...(staff ? [{ href: "/admin", label: "Admin" }] : [])].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={l.href === current ? "page" : undefined}
              className={
                l.href === current
                  ? "blend-meta shrink-0 rounded-full px-3 py-1.5 font-medium text-white shadow-md shadow-fuchsia-500/20"
                  : "shrink-0 rounded-full px-3 py-1.5 text-ink-soft hover:bg-white/40 hover:text-ink dark:hover:bg-white/10"
              }
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <form
          className="ml-auto flex shrink-0 items-center gap-3 text-sm"
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <span className="hidden text-ink-soft lg:inline">{email}</span>
          <button type="submit" className="rounded-full px-3 py-1.5 text-ink-soft hover:bg-white/40 hover:text-ink dark:hover:bg-white/10">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
