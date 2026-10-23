"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import type { Frequency, Platform, PostFormat } from "@prisma/client";
import { PlatformBadge, platforms } from "@/components/platforms";
import { formatSupport, type PlatformVerdict } from "@/lib/policy/rules";
import {
  connectWhatsApp,
  connectWhatsAppFromEnv,
  deleteChannel,
  disconnectAccount,
  saveChannel,
  type ActionState,
} from "./actions";

export type ChannelView = {
  id: string;
  platform: Platform;
  format: PostFormat;
  advertId: string | null;
  frequency: Frequency;
  runAtLocal: string; // yyyy-mm-ddThh:mm in channel timezone
  timeOfDay: string;
  weekdays: number[];
  dayOfMonth: number | null;
  enabled: boolean;
  scheduleText: string;
  nextRunText: string | null;
  lastRunText: string | null;
  lastError: string | null;
  timezoneLabel: string;
  whatsappRecipients: string[];
  whatsappTemplate: string | null;
  whatsappTemplateLang: string;
};
export type AccountView = { id: string; displayName: string; connectedText: string };
export type AdvertView = { id: string; label: string; thumbnail: string | null };
export type ConnectView = { href?: string; ready: boolean; setupHint: string; envReady?: boolean };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "ONCE", label: "Once" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
];
const statusCopy: Record<PlatformVerdict["status"], { label: string; className: string }> = {
  pass: { label: "Ready to post", className: "bg-wa/15 text-emerald-700 dark:text-emerald-300" },
  warn: { label: "Check before posting", className: "bg-amber-400/20 text-amber-800 dark:text-amber-200" },
  block: { label: "Can't post", className: "bg-danger/15 text-danger" },
};

const field = "w-full rounded-xl border border-line bg-white/55 px-3 py-2 dark:bg-white/5";
const pill = (on: boolean) =>
  `cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors ${
    on ? "border-transparent bg-ink text-white dark:bg-white dark:text-ink" : "border-line text-ink-soft hover:text-ink"
  }`;

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  );
}

function Verdict({ verdict }: { verdict: PlatformVerdict }) {
  return (
    <div className="rounded-2xl border border-line bg-white/35 p-3 text-sm dark:bg-white/5">
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusCopy[verdict.status].className}`}>
        {statusCopy[verdict.status].label}
      </span>
      {verdict.issues.length > 0 && (
        <ul className="mt-2 space-y-1 text-ink-soft">
          {verdict.issues.map((i) => (
            <li key={i.code} className="flex gap-2">
              <span aria-hidden className={`mt-1.5 size-1.5 shrink-0 rounded-full ${i.severity === "block" ? "bg-danger" : "bg-amber-500"}`} />
              {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Settings({
  channel,
  accounts,
  connect,
  admin,
}: {
  channel: ChannelView;
  accounts: AccountView[];
  connect: ConnectView;
  admin: boolean;
}) {
  const name = platforms[channel.platform].name;
  const [pending, start] = useTransition();
  const [waState, waAction, waPending] = useActionState(connectWhatsApp, undefined);
  const [envState, setEnvState] = useState<ActionState>();
  const wa = envState ?? waState;

  return (
    <section aria-label={`${name} settings`} className="self-start rounded-3xl border border-line bg-white/25 p-5 dark:bg-white/[0.03]">
      <h3 className="font-semibold">Settings</h3>
      <p className="mt-0.5 text-sm text-ink-soft">Connected {name} accounts</p>

      {accounts.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">No account connected.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-2.5">
              <span className="size-2 shrink-0 rounded-full bg-wa" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.displayName}</p>
                <p className="text-xs text-ink-soft">{a.connectedText}</p>
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
      )}

      {admin && channel.platform !== "WHATSAPP" && (
        <div className="mt-4">
          {connect.ready && connect.href ? (
            <a
              href={connect.href}
              className={`${platforms[channel.platform].blend} inline-block rounded-full px-4 py-2 text-sm font-medium text-white shadow-md`}
            >
              {accounts.length ? "Add another account" : "Add account"}
            </a>
          ) : (
            <p className="rounded-2xl border border-dashed border-line px-3 py-2.5 text-xs text-ink-soft">{connect.setupHint}</p>
          )}
        </div>
      )}

      {admin && channel.platform === "WHATSAPP" && (
        <div className="mt-4 space-y-3">
          {connect.envReady && (
            <button
              type="button"
              onClick={() => start(async () => setEnvState(await connectWhatsAppFromEnv()))}
              className="blend-whatsapp rounded-full px-4 py-2 text-sm font-medium text-white shadow-md"
            >
              Add number from server settings
            </button>
          )}
          <details className="text-sm" open={accounts.length === 0 && !connect.envReady}>
            <summary className="cursor-pointer text-ink-soft hover:text-ink">Add account with an access token</summary>
            <form action={waAction} className="mt-3 space-y-2">
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
                disabled={waPending}
                className="rounded-full border border-line bg-white/50 px-4 py-1.5 font-medium hover:bg-white/80 disabled:opacity-60 dark:bg-white/10"
              >
                {waPending ? "Checking with Meta…" : "Add account"}
              </button>
            </form>
          </details>
          {wa?.error && <p role="alert" className="text-sm text-danger">{wa.error}</p>}
          {wa?.ok && <p className="text-sm text-emerald-700 dark:text-emerald-300">{wa.message}</p>}
        </div>
      )}
    </section>
  );
}

function SocialContainer({ channel, adverts, admin }: { channel: ChannelView; adverts: AdvertView[]; admin: boolean }) {
  const [state, action, saving] = useActionState(saveChannel, undefined);
  const [format, setFormat] = useState<PostFormat>(channel.format);
  const [frequency, setFrequency] = useState<Frequency>(channel.frequency);
  const [weekdays, setWeekdays] = useState<number[]>(channel.weekdays);
  const [advertId, setAdvertId] = useState(channel.advertId ?? "");
  const support = formatSupport[channel.platform];
  const advert = adverts.find((a) => a.id === advertId);
  const result = state;
  const disabled = !admin;

  return (
    <form action={action} className="glass space-y-5 rounded-3xl p-5">
      <input type="hidden" name="id" value={channel.id} />

      <fieldset disabled={disabled}>
        <legend className="font-semibold">Post as</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["POST", "STORY"] as PostFormat[]).map((f) => {
            const s = support[f];
            return (
              <label key={f} className={`${pill(format === f)} ${s.supported ? "" : "cursor-not-allowed opacity-45"}`} title={s.reason}>
                <input
                  type="radio"
                  name="format"
                  value={f}
                  checked={format === f}
                  disabled={!s.supported}
                  onChange={() => setFormat(f)}
                  className="sr-only"
                />
                {s.label}
              </label>
            );
          })}
        </div>
        {(["POST", "STORY"] as PostFormat[])
          .filter((f) => !support[f].supported)
          .map((f) => (
            <p key={f} className="mt-2 text-xs text-ink-soft">
              {support[f].label} isn’t available: {support[f].reason}
            </p>
          ))}
      </fieldset>

      <fieldset disabled={disabled}>
        <legend className="font-semibold">Advert</legend>
        <div className="mt-2 flex items-start gap-3">
          {advert?.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={advert.thumbnail} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
          ) : (
            <div className="size-14 shrink-0 rounded-xl border border-dashed border-line" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <select name="advertId" value={advertId} onChange={(e) => setAdvertId(e.target.value)} className={field} aria-label="Advert">
              <option value="">Choose a saved advert…</option>
              {adverts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <Link href="/create" className="mt-1 inline-block text-xs text-ink-soft underline-offset-2 hover:text-ink hover:underline">
              Create a new advert
            </Link>
            {channel.platform === "X" && (
              <p className="mt-1 text-xs text-ink-soft">
                X rejects a post that repeats one you made recently, so a repeating schedule needs a different advert
                each time.
              </p>
            )}
          </div>
        </div>
      </fieldset>

      <fieldset disabled={disabled}>
        <legend className="font-semibold">Schedule</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {FREQUENCIES.map((f) => (
            <label key={f.value} className={pill(frequency === f.value)}>
              <input
                type="radio"
                name="frequency"
                value={f.value}
                checked={frequency === f.value}
                onChange={() => setFrequency(f.value)}
                className="sr-only"
              />
              {f.label}
            </label>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          {frequency === "ONCE" ? (
            <label className="block text-sm">
              <span className="text-xs font-medium">Date and time</span>
              <input type="datetime-local" name="runAt" defaultValue={channel.runAtLocal} className={field} />
            </label>
          ) : (
            <label className="block text-sm">
              <span className="text-xs font-medium">Time</span>
              <input type="time" name="timeOfDay" defaultValue={channel.timeOfDay} className={field} />
            </label>
          )}
          {frequency === "MONTHLY" && (
            <label className="block text-sm">
              <span className="text-xs font-medium">Day of the month</span>
              <select name="dayOfMonth" defaultValue={channel.dayOfMonth ?? ""} className={field}>
                <option value="" disabled>
                  Choose…
                </option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="pb-2 text-xs text-ink-soft">{channel.timezoneLabel}</span>
        </div>

        {frequency === "WEEKLY" && (
          <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Days of the week">
            {WEEKDAYS.map((d, i) => (
              <label key={d} className={`${pill(weekdays.includes(i))} px-2.5`}>
                <input
                  type="checkbox"
                  name="weekdays"
                  value={i}
                  checked={weekdays.includes(i)}
                  onChange={(e) => setWeekdays((w) => (e.target.checked ? [...w, i] : w.filter((x) => x !== i)))}
                  className="sr-only"
                />
                {d}
              </label>
            ))}
          </div>
        )}
        {frequency === "MONTHLY" && (
          <p className="mt-2 text-xs text-ink-soft">In shorter months, it posts on the last day instead.</p>
        )}
      </fieldset>

      {channel.platform === "WHATSAPP" && (
        <fieldset disabled={disabled} className="space-y-3">
          <legend className="font-semibold">Recipients</legend>
          <label className="block text-sm">
            <span className="text-xs font-medium">Phone numbers, one per line, international format</span>
            <textarea
              name="whatsappRecipients"
              rows={3}
              defaultValue={channel.whatsappRecipients.join("\n")}
              placeholder={"254712345678\n254798765432"}
              className={field}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="block flex-1 text-sm">
              <span className="text-xs font-medium">Approved template name</span>
              <input name="whatsappTemplate" defaultValue={channel.whatsappTemplate ?? ""} placeholder="weekly_offer" className={field} />
            </label>
            <label className="block w-28 text-sm">
              <span className="text-xs font-medium">Language</span>
              <input name="whatsappTemplateLang" defaultValue={channel.whatsappTemplateLang} className={field} />
            </label>
          </div>
          <p className="text-xs text-ink-soft">
            WhatsApp only delivers free-form messages to people who messaged you in the last 24 hours. For scheduled
            messages, use a template Meta has approved.
          </p>
        </fieldset>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <label className={`flex items-center gap-2 text-sm ${disabled ? "opacity-60" : "cursor-pointer"}`}>
          <input type="checkbox" name="enabled" defaultChecked={channel.enabled} disabled={disabled} className="peer sr-only" />
          <span
            aria-hidden
            className="relative h-6 w-11 rounded-full bg-ink/15 transition-colors after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-wa peer-checked:after:translate-x-5 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--ig-3)] dark:bg-white/20"
          />
          Schedule on
        </label>
        {admin && (
          <>
            <button
              type="submit"
              disabled={saving}
              className="ml-auto rounded-full bg-ink px-5 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-ink"
            >
              {saving ? "Working…" : "Save"}
            </button>
            <button
              type="submit"
              // Same form, flagged so the server posts right after saving
              formAction={(fd: FormData) => {
                fd.set("intent", "post");
                action(fd);
              }}
              disabled={saving}
              className="rounded-full border border-line bg-white/50 px-4 py-2 text-sm font-medium hover:bg-white/80 disabled:opacity-60 dark:bg-white/10"
            >
              Post now
            </button>
          </>
        )}
      </div>

      <div className="space-y-1 text-sm" aria-live="polite">
        <p className="text-ink-soft">
          {channel.enabled && channel.nextRunText ? (
            <>
              <span className="font-medium text-ink">Next post:</span> {channel.nextRunText} · {channel.scheduleText}
            </>
          ) : (
            "Schedule is off."
          )}
        </p>
        {channel.lastRunText && <p className="text-ink-soft">Last run: {channel.lastRunText}</p>}
        {channel.lastError && <p className="text-danger">Last run failed: {channel.lastError}</p>}
        {result?.error && <p role="alert" className="text-danger">{result.error}</p>}
        {result?.ok && result.message && <p className="text-emerald-700 dark:text-emerald-300">{result.message}</p>}
        {result?.verdict && <Verdict verdict={result.verdict} />}
      </div>
    </form>
  );
}

// Parent container: the platform's settings plus its social container.
export function ChannelCard({
  channel,
  accounts,
  adverts,
  connect,
  admin,
}: {
  channel: ChannelView;
  accounts: AccountView[];
  adverts: AdvertView[];
  connect: ConnectView;
  admin: boolean;
}) {
  const p = platforms[channel.platform];
  const [deleting, startDelete] = useTransition();
  const status =
    accounts.length === 0
      ? "No account connected"
      : channel.enabled && channel.nextRunText
        ? `Active · next post ${channel.nextRunText}`
        : "Schedule off";

  return (
    <article className="glass relative overflow-hidden rounded-[32px] p-5 sm:p-6" aria-label={`${p.name} container`}>
      <div aria-hidden className={`${p.blend} pointer-events-none absolute -top-24 -right-24 size-64 rounded-full opacity-30 blur-3xl`} />
      <header className="relative flex items-center gap-3">
        <PlatformBadge platform={channel.platform} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">{p.name}</h2>
          <p className="text-sm text-ink-soft">{status}</p>
        </div>
        {admin && (
          <button
            type="button"
            disabled={deleting}
            onClick={() => {
              if (confirm(`Delete the ${p.name} container? This stops its schedule and disconnects its accounts.`)) {
                startDelete(async () => void (await deleteChannel(channel.id)));
              }
            }}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-ink-soft hover:bg-danger/10 hover:text-danger"
          >
            <TrashIcon />
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
      </header>
      <div className="relative mt-5 grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
        <Settings channel={channel} accounts={accounts} connect={connect} admin={admin} />
        <SocialContainer channel={channel} adverts={adverts} admin={admin} />
      </div>
    </article>
  );
}
