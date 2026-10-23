import { prisma } from "@/lib/db";
import { pageViewer } from "@/lib/session";
import { RoleButton } from "../buttons";

export const dynamic = "force-dynamic";

const roleLabel = { USER: "User", ADMIN: "Admin", SUPER_ADMIN: "Super admin" } as const;

// Super admin only: promote users to admin and demote admins to users.
export default async function RolesPage() {
  const viewer = await pageViewer("super");
  const people = await prisma.user.findMany({ orderBy: [{ role: "desc" }, { createdAt: "asc" }], take: 500 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Roles</h1>
        <p className="mt-2 max-w-prose text-ink-soft">
          Admins manage adverts, channels, the audience and users. Changes apply on the person&rsquo;s next click, and
          are recorded in their activity.
        </p>
      </div>
      <section className="glass rounded-3xl p-6">
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
        </ul>
      </section>
    </div>
  );
}
