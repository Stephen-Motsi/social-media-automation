import { prisma } from "@/lib/db";
import { ensureAllContainers } from "@/lib/channels";
import { isStaff, pageViewer } from "@/lib/session";
import { UserHeader } from "../header";
import { AccountsPanel } from "./panel";
import { listOwnedSocialAccounts } from "@/lib/owned-social-accounts";

export const dynamic = "force-dynamic";

export default async function SocialAccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await pageViewer("user");
  const staff = isStaff(viewer.role);
  await ensureAllContainers(viewer.id);
  const [accounts, channels, params, whatsappRequest] = await Promise.all([
    listOwnedSocialAccounts(viewer.id),
    prisma.channel.findMany({ where: { ownerId: viewer.id }, select: { platform: true, handle: true } }),
    searchParams,
    staff ? prisma.whatsappConnectionRequest.findUnique({ where: { userId: viewer.id }, select: { id: true } }) : null,
  ]);
  return (
    <div className="min-h-screen pb-16">
      <UserHeader email={viewer.email} current="/me/accounts" staff={staff} />
      <main className="rise mx-auto max-w-5xl space-y-6 px-4 pt-10">
        <h1 className="text-3xl font-semibold">Social accounts</h1>
        <p className="text-ink-soft">Connect your own accounts. A handle identifies the account; provider sign-in authorizes it.</p>
        {typeof params.error === "string" && <p role="alert" className="rounded-xl border border-red-400 p-3">Connection failed: {params.error.replaceAll("_", " ")}. Check the handle and provider permissions, then try again.</p>}
        {typeof params.connected === "string" && <p role="status" className="rounded-xl border border-green-400 p-3">Provider authorization completed for {params.connected} account(s).</p>}
        <AccountsPanel accounts={accounts.map((a) => ({ ...a, tokenExpiresAt: a.tokenExpiresAt?.toISOString() ?? null, disconnectedAt: a.disconnectedAt?.toISOString() ?? null }))} channels={channels} staffDirectWhatsapp={staff && !whatsappRequest} />
      </main>
    </div>
  );
}
