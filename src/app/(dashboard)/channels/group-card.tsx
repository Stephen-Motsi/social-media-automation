"use client";

import { useActionState, useState, useTransition } from "react";
import type { GroupKind, Platform } from "@prisma/client";
import { PlatformBadge, platforms } from "@/components/platforms";
import { groupNames, handleLabels } from "@/lib/handles";
import { connectHandle, connectWhatsApp, connectWhatsAppFromEnv, disconnectAccount, setHandle, type ActionState } from "./actions";
import { SocialContainer, field, type ChannelView } from "./social-container";

export type AccountView = {
  id: string;
  displayName: string;
  connectedText: string;
  profileUrl: string | null;
  matches: boolean;
  // When the access token stops working (e.g. a 60-day Facebook token); null if it doesn't expire
  expiresText: string | null;
};
export type PlatformView = {
  channel: ChannelView;
  handleInput: string;
  handleDisplay: string;
  profileUrl: string | null;
  accounts: AccountView[];
  // Connect from the handle with the business's credentials (.env); setup says what's missing
  byHandle: { ready: boolean; setup: string };
};
export type ConnectView = { href: string; ready: boolean; setupHint: string };

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
      {children}
      <span aria-hidden> ↗</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function MetaMark() {
  return (
    <span aria-hidden className="relative flex h-12 w-16 items-center">
      <span className="blend-facebook absolute left-0 size-9 rounded-full ring-2 ring-white/70" />
      <span className="blend-instagram absolute left-3.5 size-9 rounded-full ring-2 ring-white/70" />
      <span className="blend-whatsapp absolute left-7 size-9 rounded-full ring-2 ring-white/70" />
    </span>
  );
}

// Fallbacks for WhatsApp when the Facebook sign-in isn't used.
function WhatsAppAdvanced({ envReady }: { envReady: boolean }) {
  const [state, action, pending] = useActionState(connectWhatsApp, undefined);
  const [envState, setEnvState] = useState<ActionState>();
  const [envPending, startEnv] = useTransition();
  const result = envState ?? state;
  return (
    <div className="mt-2 space-y-2">
      {envReady && (
        <button
          type="button"
          disabled={envPending}
          onClick={() => startEnv(async () => setEnvState(await connectWhatsAppFromEnv()))}
          className="blend-whatsapp rounded-full px-4 py-2 text-sm font-medium text-white shadow-md disabled:opacity-60"
        >
          {envPending ? "Looking up the number…" : "Connect using the server's WhatsApp token"}
        </button>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-ink-soft hover:text-ink">Advanced: enter the phone number ID and token yourself</summary>
        <form action={action} className="mt-2 space-y-2">
          <label className="block">
            <span className="text-xs font-medium">Phone number ID</span>
            <input name="phoneNumberId" inputMode="numeric" autoComplete="off" required className={field} />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Access token</span>
            <input name="accessToken" type="password" autoComplete="off" required className={field} />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-full border border-line bg-white/50 px-4 py-1.5 font-medium hover:bg-white/80 disabled:opacity-60 dark:bg-white/10"
          >
            {pending ? "Checking with Meta…" : "Connect number"}
          </button>
        </form>
      </details>
      {result?.error && <p role="alert" className="text-sm text-danger">{result.error}</p>}
      {result?.ok && <p className="text-sm text-emerald-700 dark:text-emerald-300">{result.message}</p>}
    </div>
  );
}

// One platform in Settings: the number/handle/link it posts to (editable here) and what's connected.
function HandleRow({ item, admin, extra }: { item: PlatformView; admin: boolean; extra?: React.ReactNode }) {
  const p = item.channel.platform;
  const [editing, setEditing] = useState(!item.handleInput);
  const [value, setValue] = useState(item.handleInput);
  const [state, setState] = useState<ActionState>();
  const [pending, start] = useTransition();
  const label = handleLabels[p];
  const connected = item.accounts.some((a) => a.matches);
  return (
    <li>
      <div className="flex items-center gap-2">
        <PlatformBadge platform={p} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{platforms[p].name}</p>
          {!editing && (
            <p className="truncate text-xs text-ink-soft">
              {item.profileUrl ? <ExternalLink href={item.profileUrl}>{item.handleDisplay}</ExternalLink> : item.handleDisplay}
            </p>
          )}
        </div>
        {admin && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="rounded-full px-2.5 py-1 text-xs text-ink-soft hover:text-ink">
            Change
          </button>
        )}
      </div>
      {admin && editing && (
        <form
          className="mt-2 flex flex-wrap gap-2 pl-9"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await setHandle(item.channel.id, value);
              setState(res);
              if (res?.ok) setEditing(false);
            });
          }}
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={label.placeholder}
            aria-label={`${label.label}: number, handle or link`}
            className={`${field} min-w-0 flex-1 text-sm`}
          />
          <button type="submit" disabled={pending} className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-ink">
            {pending ? (item.byHandle.ready ? "Saving and connecting…" : "Saving…") : item.byHandle.ready ? "Save & connect" : "Save"}
          </button>
          {item.handleInput && (
            <button type="button" onClick={() => setEditing(false)} className="px-2 text-xs text-ink-soft hover:text-ink">
              Cancel
            </button>
          )}
          <p className="w-full text-xs text-ink-soft">{label.hint}. Paste a link or type it; either works.</p>
        </form>
      )}
      {admin && !editing && item.handleInput && !connected && (
        <div className="mt-2 pl-9">
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => setState(await connectHandle(item.channel.id)))}
            className={`${platforms[p].blend} rounded-full px-3.5 py-1.5 text-xs font-medium text-white shadow-sm`}
          >
            {pending ? "Connecting…" : `Connect ${item.handleDisplay}`}
          </button>
          {!item.byHandle.ready && <p className="mt-1 text-xs text-ink-soft">To connect from the handle, {item.byHandle.setup}.</p>}
        </div>
      )}
      {state?.error && <p role="alert" className="mt-1 pl-9 text-xs text-danger">{state.error}</p>}
      {state?.ok && state.message && <p role="status" className="mt-1 pl-9 text-xs font-medium text-emerald-700 dark:text-emerald-300">{state.message}</p>}
      {state?.ok && state.note && <p className="mt-1 pl-9 text-xs text-amber-800 dark:text-amber-200">{state.note}</p>}
      <AccountList accounts={item.accounts} admin={admin} />
      {extra && <div className="pl-9">{extra}</div>}
    </li>
  );
}

function AccountList({ accounts, admin }: { accounts: AccountView[]; admin: boolean }) {
  const [pending, start] = useTransition();
  if (accounts.length === 0) return <p className="mt-2 pl-9 text-xs text-ink-soft">Not connected yet.</p>;
  return (
    <ul className="mt-2 space-y-1.5 pl-9">
      {accounts.map((a) => (
        <li key={a.id} className="flex items-center gap-2">
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${a.matches ? "bg-wa" : "bg-amber-500"}`} />
          <div className="min-w-0 flex-1 text-xs">
            <p className="truncate font-medium">{a.profileUrl ? <ExternalLink href={a.profileUrl}>{a.displayName}</ExternalLink> : a.displayName}</p>
            <p className="text-ink-soft">
              {a.matches ? `Connected · ${a.connectedText}` : "Doesn't match the handle, so nothing is posted here"}
              {a.matches && a.expiresText ? ` · reconnect before ${a.expiresText}` : ""}
            </p>
          </div>
          {admin && (
            <button
              type="button"
              disabled={pending}
              onClick={() => start(async () => void (await disconnectAccount(a.id)))}
              className="rounded-full px-2.5 py-1 text-xs text-ink-soft hover:bg-danger/10 hover:text-danger"
            >
              Disconnect
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// Settings: the numbers/handles each platform posts to, and connecting the real accounts behind them.
function Settings({
  kind,
  items,
  connect,
  whatsappEnvReady,
  admin,
}: {
  kind: GroupKind;
  items: PlatformView[];
  connect: ConnectView | null;
  whatsappEnvReady: boolean;
  admin: boolean;
}) {
  const needsConnect = items.some((i) => !i.accounts.some((a) => a.matches));
  const names = items.map((i) => platforms[i.channel.platform].name);
  const connectLabel =
    kind === "META" ? `Connect ${names.length > 1 ? `${names.slice(0, -1).join(", ")} & ${names.at(-1)}` : names[0]}` : `Connect ${items[0]?.handleDisplay}`;
  const wa = items.find((i) => i.channel.platform === "WHATSAPP");

  return (
    <section aria-label={`${groupNames[kind]} settings`} className="self-start rounded-3xl border border-line bg-white/25 p-5 dark:bg-white/[0.03]">
      <h3 className="font-semibold">Settings</h3>
      <p className="mt-0.5 text-sm text-ink-soft">Type the number, handle or link of each account. It connects from the handle; no copying IDs or tokens.</p>

      <ul className="mt-4 space-y-4">
        {items.map((i) => (
          <HandleRow
            key={i.channel.platform}
            item={i}
            admin={admin}
            extra={
              admin && i === wa && !i.accounts.some((a) => a.matches) ? <WhatsAppAdvanced envReady={whatsappEnvReady} /> : undefined
            }
          />
        ))}
      </ul>

      {admin && connect && items.length > 0 && (connect.ready || !items.every((i) => i.byHandle.ready)) && (
        <div className="mt-5 border-t border-line pt-4">
          {connect.ready ? (
            <>
              <a
                href={connect.href}
                aria-disabled={items.some((i) => !i.handleInput)}
                className={`${kind === "META" ? "blend-facebook" : platforms[items[0].channel.platform].blend} inline-block rounded-full px-4 py-2 text-sm font-medium text-white shadow-md ${items.some((i) => !i.handleInput) ? "pointer-events-none opacity-50" : ""}`}
              >
                {needsConnect ? `Or sign in: ${connectLabel}` : "Reconnect by signing in"}
              </a>
              <p className="mt-2 text-xs text-ink-soft">
                {kind === "META"
                  ? `You'll sign in with Facebook once and approve access. The backend then finds the ${names.join(", ")} you entered above and sets up the connection${wa ? ", including WhatsApp's phone number ID and access token" : ""}.`
                  : "You'll sign in on the platform and approve access. Only the account matching the handle above is linked."}
              </p>
            </>
          ) : items.every((i) => i.byHandle.ready) ? null : (
            // Only matters when the handles can't connect on their own
            <p className="rounded-2xl border border-dashed border-line px-3 py-2.5 text-xs text-ink-soft">Optional sign-in instead of handles: {connect.setupHint.replace(/^Not set up yet: /, "")}</p>
          )}
        </div>
      )}
    </section>
  );
}

// Parent container: settings for the group's accounts, plus one social container per platform.
export function GroupCard({
  group,
  items,
  connect,
  whatsappEnvReady,
  admin,
}: {
  group: { id: string; kind: GroupKind };
  items: PlatformView[];
  connect: ConnectView | null;
  whatsappEnvReady: boolean;
  admin: boolean;
}) {
  const name = groupNames[group.kind];
  const active = items.filter((i) => i.channel.enabled).length;
  const summary =
    items.length === 0
      ? "No platforms"
      : `${items.map((i) => platforms[i.channel.platform].name).join(", ")} · ${active ? `${active} scheduled` : "no schedules on"}`;
  const glow = group.kind === "META" ? "blend-meta" : platforms[items[0]?.channel.platform ?? (group.kind as Platform)].blend;

  return (
    <article className="glass relative overflow-hidden rounded-[32px] p-5 sm:p-6" aria-label={`${name} container`}>
      <div aria-hidden className={`${glow} pointer-events-none absolute -top-24 -right-24 size-64 rounded-full opacity-30 blur-3xl`} />
      <header className="relative flex flex-wrap items-center gap-3">
        {group.kind === "META" ? <MetaMark /> : <PlatformBadge platform={group.kind as Platform} size="lg" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">{name}</h2>
          <p className="text-sm text-ink-soft">{summary}</p>
        </div>
      </header>


      <div className="relative mt-5 grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
        <Settings kind={group.kind} items={items} connect={connect} whatsappEnvReady={whatsappEnvReady} admin={admin} />
        <div className="space-y-4">
          {items.map((i) => (
            <SocialContainer key={i.channel.id} channel={i.channel} admin={admin} />
          ))}
        </div>
      </div>
    </article>
  );
}
