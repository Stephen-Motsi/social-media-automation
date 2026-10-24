"use client";

import { useActionState, useOptimistic, useState, useTransition } from "react";
import type { Platform } from "@prisma/client";
import { PlatformBadge, platforms } from "@/components/platforms";
import { linkWhatsApp, revokeOtherSessions, revokeSession, setAdvertSubscription, unlinkWhatsApp, type MeState } from "./actions";

const field = "w-full rounded-xl border border-line bg-white/55 px-3 py-2 dark:bg-white/5";

export function PlatformToggle({
  advertId,
  platform,
  handle,
  url,
  subscribed,
  disabledReason,
}: {
  advertId: string;
  platform: Platform;
  handle: string;
  url: string | null;
  subscribed: boolean;
  disabledReason?: string;
}) {
  const [on, setOn] = useOptimistic(subscribed);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<{ text?: string; link?: string | null }>();
  return (
    <li className="flex items-center gap-2">
      <PlatformBadge platform={platform} />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{platforms[platform].name}</p>
        <p className="truncate text-xs text-ink-soft">
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {handle}
            </a>
          ) : (
            handle
          )}
          {disabledReason && !on ? ` · ${disabledReason}` : ""}
        </p>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        {message?.text && (
          <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">
            {message.text}
            {message.link && (
              <>
                {" "}
                <a href={message.link} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2">
                  Open it
                </a>
              </>
            )}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${on ? "Unsubscribe from" : "Subscribe to"} this advert on ${platforms[platform].name}`}
        disabled={pending || (!!disabledReason && !on)}
        onClick={() =>
          start(async () => {
            setError(undefined);
            setMessage(undefined);
            setOn(!on);
            try {
              const res = await setAdvertSubscription(advertId, platform, !on);
              if (res?.error) setError(res.error);
              else setMessage({ text: res?.message, link: res?.link });
            } catch {
              setError("Not saved: the server didn't respond. Try again.");
            }
          })
        }
        className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
          on ? "bg-wa text-white" : "border border-line bg-white/50 hover:bg-white/80 dark:bg-white/10"
        }`}
      >
        {on ? "Subscribed" : "Subscribe"}
      </button>
    </li>
  );
}

export function WhatsAppLink({
  status,
  number,
  pending,
}: {
  status: "none" | "waiting" | "ACTIVE" | "PENDING" | "NEEDS_REVIEW" | "REJECTED" | "UNSUBSCRIBED";
  number: string | null;
  pending: { code: string; link: string | null; number: string } | null;
}) {
  const [state, action, busy] = useActionState(linkWhatsApp, undefined);
  const [removed, setRemoved] = useState<MeState>();
  const [removing, start] = useTransition();
  const join = state?.join ?? (pending ? { code: pending.code, link: pending.link } : null);

  if (status === "ACTIVE" && number) {
    return (
      <div className="text-sm">
        <p>
          <span className="font-medium">+{number}</span> <span className="text-emerald-700 dark:text-emerald-300">· linked and confirmed</span>
        </p>
        <button
          type="button"
          disabled={removing}
          onClick={() => start(async () => setRemoved(await unlinkWhatsApp()))}
          className="mt-2 rounded-full px-3 py-1 text-xs text-ink-soft hover:bg-danger/10 hover:text-danger"
        >
          Remove my number
        </button>
        {removed?.message && <p className="mt-1 text-xs text-ink-soft">{removed.message}</p>}
      </div>
    );
  }
  if (status === "NEEDS_REVIEW") return <p className="text-sm text-ink-soft">+{number}: confirmed, and being reviewed by our team.</p>;

  return (
    <div className="space-y-3">
      {join ? (
        <div className="rounded-2xl border border-line bg-white/40 p-4 text-center dark:bg-white/5">
          <p className="text-sm text-ink-soft">Send this from {pending ? `+${pending.number}` : "your number"} to confirm it&rsquo;s yours:</p>
          <p className="mt-2 font-mono text-xl tracking-widest">JOIN {join.code}</p>
          {join.link && (
            <a href={join.link} className="blend-whatsapp mt-3 inline-block rounded-full px-5 py-2 text-sm font-medium text-white">
              Open WhatsApp and send
            </a>
          )}
        </div>
      ) : null}
      <form action={action} className="space-y-2">
        <label className="block text-sm">
          <span className="text-xs font-medium">{join ? "Use a different number" : "Your WhatsApp number"}</span>
          <input name="phone" inputMode="tel" required placeholder="0712 345 678" className={field} />
        </label>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" name="consent" required className="mt-0.5 size-4 accent-[var(--ig-3)]" />
          <span>I agree to receive the adverts I subscribe to on WhatsApp. I can stop them any time by replying STOP.</span>
        </label>
        <button type="submit" disabled={busy} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-ink">
          {busy ? "Saving…" : "Link number"}
        </button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </form>
    </div>
  );
}

export function SessionButtons({ id, current }: { id?: string; current?: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string>();
  if (id) {
    return current ? (
      <span className="text-xs text-emerald-700 dark:text-emerald-300">This device</span>
    ) : (
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => void (await revokeSession(id)))}
        className="rounded-full px-2.5 py-1 text-xs text-ink-soft hover:bg-danger/10 hover:text-danger"
      >
        Sign out
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setMsg((await revokeOtherSessions())?.message))}
        className="rounded-full border border-line px-3 py-1.5 text-xs font-medium hover:bg-white/60 dark:hover:bg-white/10"
      >
        Sign out all other devices
      </button>
      {msg && <span className="text-xs text-ink-soft">{msg}</span>}
    </span>
  );
}
