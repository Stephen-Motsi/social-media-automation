import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const accounts = await prisma.socialAccount.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Connected accounts</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Facebook Pages, Instagram Business accounts and WhatsApp numbers.
      </p>

      {/* TODO: "Connect with Facebook" button -> Facebook Login for Business OAuth flow
          (see README "Next steps"), then store Page / IG tokens encrypted. */}

      {accounts.length === 0 ? (
        <p className="mt-8 text-ink-soft">No accounts connected yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-line">
          {accounts.map((a) => (
            <li key={a.id} className="flex justify-between py-3">
              <span>{a.displayName}</span>
              <span className="text-sm text-ink-soft">{a.platform}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
