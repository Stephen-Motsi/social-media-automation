import type { Platform, SocialAccount } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { metaConfigured, redirectUri } from "@/lib/meta/oauth";
import { PlatformBadge, platforms } from "@/components/platforms";
import { disconnectAccount } from "./actions";
import { WhatsAppForm } from "./whatsapp-form";

export const dynamic = "force-dynamic";

const notices: Record<string, string> = {
  admin_only: "Only admins can connect or disconnect accounts.",
  not_configured: "Facebook connection isn't set up yet. Add META_APP_ID and META_APP_SECRET to the .env file.",
  cancelled: "Facebook connection was cancelled. Nothing was changed.",
  state_mismatch: "That connection attempt expired or didn't come from this site. Try again.",
  no_code: "Facebook didn't return an authorisation code. Try again.",
  no_pages:
    "No Facebook Pages were shared. Connect again and select at least one Page. You need to be an admin of the Page.",
  meta_error: "Facebook returned an error while connecting. Try again; if it keeps happening, check the server log.",
};

const joined = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

function AccountList({ accounts, admin }: { accounts: SocialAccount[]; admin: boolean }) {
  if (accounts.length === 0) return null;
  return (
    <ul className="mt-4 divide-y divide-line">
      {accounts.map((a) => (
        <li key={a.id} className="flex items-center gap-3 py-3">
          <PlatformBadge platform={a.platform} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{a.displayName}</p>
            <p className="text-xs text-ink-soft">Connected {joined.format(a.createdAt)}</p>
          </div>
          {admin && (
            <form action={disconnectAccount}>
              <input type="hidden" name="id" value={a.id} />
              <button type="submit" className="rounded-full px-3 py-1.5 text-sm text-ink-soft hover:bg-danger/10 hover:text-danger">
                Disconnect
              </button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const [{ error, connected }, session, accounts] = await Promise.all([
    searchParams,
    auth(),
    prisma.socialAccount.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  const admin = session?.user?.role === "ADMIN";
  const by = (p: Platform) => accounts.filter((a) => a.platform === p);
  const facebookReady = metaConfigured();
  const whatsappEnvReady = Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Accounts</h1>
      <p className="mt-2 max-w-prose text-ink-soft">
        Connect the Facebook Pages, Instagram accounts and WhatsApp numbers you want to post to.
      </p>

      {error && notices[error] && (
        <p role="alert" className="glass mt-6 rounded-2xl border-danger/30 px-5 py-3 text-danger">
          {notices[error]}
        </p>
      )}
      {connected && (
        <p className="glass mt-6 rounded-2xl px-5 py-3 text-emerald-700 dark:text-emerald-300">
          Connected {connected} {connected === "1" ? "account" : "accounts"}.
        </p>
      )}
      {!admin && error !== "admin_only" && (
        <p className="glass mt-6 rounded-2xl px-5 py-3 text-ink-soft">Only admins can connect or disconnect accounts.</p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="glass relative overflow-hidden rounded-[28px] p-6">
          <div aria-hidden className="blend-facebook absolute -top-20 -right-20 size-56 rounded-full opacity-30 blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <PlatformBadge platform="FACEBOOK" size="lg" />
              <PlatformBadge platform="INSTAGRAM" size="lg" />
            </div>
            <h2 className="mt-5 text-xl font-semibold">Facebook & Instagram</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Sign in with Facebook and choose your Pages. Instagram business accounts linked to those Pages connect
              at the same time.
            </p>

            {admin &&
              (facebookReady ? (
                <a
                  href="/api/meta/connect"
                  className="blend-facebook mt-5 inline-block rounded-full px-5 py-2.5 font-medium text-white shadow-md shadow-blue-500/25"
                >
                  {by("FACEBOOK").length ? "Connect more Pages" : "Connect with Facebook"}
                </a>
              ) : (
                <p className="mt-5 rounded-2xl border border-dashed border-line px-4 py-3 text-sm text-ink-soft">
                  Not set up yet. Add <code>META_APP_ID</code> and <code>META_APP_SECRET</code> to <code>.env</code>,
                  and add <code className="break-all">{redirectUri()}</code> as a valid OAuth redirect URI in the Meta
                  app.
                </p>
              ))}

            <AccountList accounts={[...by("FACEBOOK"), ...by("INSTAGRAM")]} admin={admin} />
            {by("FACEBOOK").length > 0 && by("INSTAGRAM").length === 0 && (
              <p className="mt-2 text-sm text-ink-soft">
                No Instagram account found. Link an Instagram professional account to one of these Pages, then connect
                again.
              </p>
            )}
          </div>
        </section>

        <section className="glass relative overflow-hidden rounded-[28px] p-6">
          <div aria-hidden className="blend-whatsapp absolute -top-20 -right-20 size-56 rounded-full opacity-30 blur-3xl" />
          <div className="relative">
            <PlatformBadge platform="WHATSAPP" size="lg" />
            <h2 className="mt-5 text-xl font-semibold">{platforms.WHATSAPP.name}</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Connect a WhatsApp Business number from the WhatsApp Cloud API.
            </p>
            <div className="mt-5">{admin && <WhatsAppForm envReady={whatsappEnvReady} />}</div>
            <AccountList accounts={by("WHATSAPP")} admin={admin} />
          </div>
        </section>
      </div>
    </div>
  );
}
