import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { pageViewer } from "@/lib/session";
import { RoleButton } from "../buttons";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

const roleLabel = { USER: "User", ADMIN: "Admin", SUPER_ADMIN: "Super admin" } as const;
type RoleParams = { q?: string; role?: string; page?: string };

// Super admin only: promote users to admin and demote admins to users.
export default async function RolesPage({ searchParams }: { searchParams: Promise<RoleParams> }) {
  const viewer = await pageViewer("super");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const role = params.role === "USER" || params.role === "ADMIN" || params.role === "SUPER_ADMIN" ? params.role : "";
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const where: Prisma.UserWhereInput = {
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
    ...(role ? { role } : {}),
  };
  const total = await prisma.user.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const people = await prisma.user.findMany({
    where,
    orderBy: [{ role: "desc" }, { createdAt: "asc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  const pageHref = (target: number) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (role) next.set("role", role);
    if (target > 1) next.set("page", String(target));
    const query = next.toString();
    return `/admin/roles${query ? `?${query}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Roles</h1>
        <p className="mt-2 max-w-prose text-ink-soft">
          Admins manage adverts, channels, audiences and publishing. Promote users to admin or revoke admin access;
          changes are recorded in the audit log.
        </p>
      </div>
      <section className="glass rounded-3xl p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-sm text-ink-soft">{total.toLocaleString()} {total === 1 ? "account" : "accounts"}</p>
          <form action="/admin/roles" role="search" className="grid w-full gap-2 sm:w-auto sm:grid-cols-3">
            <label className="sr-only" htmlFor="roles-search">Search accounts</label>
            <input id="roles-search" name="q" defaultValue={q} placeholder="Name or email" className="min-w-0 rounded-xl border border-line bg-white/55 px-3 py-2 text-sm dark:bg-white/5 sm:w-52" />
            <label className="sr-only" htmlFor="roles-filter">Filter by role</label>
            <select id="roles-filter" name="role" defaultValue={role} className="rounded-xl border border-line bg-white/55 px-3 py-2 text-sm dark:bg-[#211b38]">
              <option value="">All roles</option><option value="USER">User</option><option value="ADMIN">Admin</option><option value="SUPER_ADMIN">Super admin</option>
            </select>
            <button type="submit" className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-ink">Apply</button>
          </form>
        </div>
        <ul className="divide-y divide-line">
          {people.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{p.name ?? p.email}</p>
                <p className="text-xs text-ink-soft">{p.email}</p>
              </div>
              <span className="text-sm text-ink-soft">{roleLabel[p.role]}</span>
              {p.id !== viewer.id && p.role !== "SUPER_ADMIN" ? (
                <RoleButton userId={p.id} role={p.role as "USER" | "ADMIN"} name={p.name ?? p.email} />
              ) : (
                <span className="w-28 text-right text-xs text-ink-soft">{p.id === viewer.id ? "You" : "—"}</span>
              )}
            </li>
          ))}
          {people.length === 0 && <li className="py-10 text-center text-sm text-ink-soft">No accounts match these filters.</li>}
        </ul>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-xs text-ink-soft">Page {page} of {totalPages}</p>
          <nav aria-label="Role management pages" className="flex items-center gap-2">
            <Link tabIndex={page <= 1 ? -1 : undefined} aria-disabled={page <= 1} href={pageHref(Math.max(1, page - 1))} className={`rounded-full border border-line px-3 py-1.5 text-xs ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-white/50 dark:hover:bg-white/10"}`}>Previous</Link>
            <Link tabIndex={page >= totalPages ? -1 : undefined} aria-disabled={page >= totalPages} href={pageHref(Math.min(totalPages, page + 1))} className={`rounded-full border border-line px-3 py-1.5 text-xs ${page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-white/50 dark:hover:bg-white/10"}`}>Next</Link>
          </nav>
        </div>
      </section>
    </div>
  );
}
