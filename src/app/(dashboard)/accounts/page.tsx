import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const accounts = await prisma.socialAccount.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div>
      <h1 className="text-2xl font-semibold">Connected accounts</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Facebook Pages, Instagram Business accounts and WhatsApp numbers.
      </p>

      {/* TODO: "Connect with Facebook" button -> Facebook Login for Business OAuth flow
          (see README "Next steps"), then store Page / IG tokens encrypted. */}

      {accounts.length === 0 ? (
        <p className="mt-8 text-neutral-500">No accounts connected yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-neutral-200 dark:divide-neutral-800">
          {accounts.map((a) => (
            <li key={a.id} className="flex justify-between py-3">
              <span>{a.displayName}</span>
              <span className="text-sm text-neutral-500">{a.platform}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
