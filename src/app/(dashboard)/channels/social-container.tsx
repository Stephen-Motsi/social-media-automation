"use client";

import { useActionState, useEffect, useState } from "react";
import { keepValues } from "@/lib/keep-form";
import type { Frequency, Platform, PostFormat } from "@prisma/client";
import { platforms } from "@/components/platforms";
import { formatSupport, type PlatformVerdict } from "@/lib/policy/rules";
import { saveChannel } from "./actions";
import { AdvertComposer, type ComposerAdvert } from "./advert-composer";

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
  advert: ComposerAdvert | null;
  uploadHint: string;
  // A connected account matches this container's handle (needed to post)
  connected: boolean;
  handleDisplay: string;
};

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

export const field = "w-full rounded-xl border border-line bg-white/55 px-3 py-2 dark:bg-white/5";
export const pill = (on: boolean) =>
  `cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors ${
    on ? "border-transparent bg-ink text-white dark:bg-white dark:text-ink" : "border-line text-ink-soft hover:text-ink"
  }`;

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

// The social container: post format, advert and schedule for one platform.
export function SocialContainer({ channel, admin }: { channel: ChannelView; admin: boolean }) {
  const [state, action, saving] = useActionState(saveChannel, undefined);
  const [format, setFormat] = useState<PostFormat>(channel.format);
  const [frequency, setFrequency] = useState<Frequency>(channel.frequency);
  const [weekdays, setWeekdays] = useState<number[]>(channel.weekdays);
  const support = formatSupport[channel.platform];
  const result = state;
  // "Saved ✓" on the button for a few seconds after each successful save
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!state?.ok) return;
    setJustSaved(true);
    const t = setTimeout(() => setJustSaved(false), 4000);
    return () => clearTimeout(t);
  }, [state]);
  const disabled = !admin;

  return (
    <form onSubmit={keepValues(action)} className="glass space-y-5 rounded-3xl p-5" aria-label={`${platforms[channel.platform].name} schedule`}>
      <input type="hidden" name="id" value={channel.id} />
      <h3 className="flex items-center gap-2 font-semibold">
        <span className={`${platforms[channel.platform].blend} size-2.5 rounded-full`} aria-hidden />
        {platforms[channel.platform].name}
      </h3>

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

      <AdvertComposer
        channelId={channel.id}
        platform={channel.platform}
        uploadHint={channel.uploadHint}
        initial={channel.advert}
        disabled={disabled}
      />

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
              className={`ml-auto rounded-full px-5 py-2 text-sm font-medium text-white ${justSaved ? "bg-wa" : "bg-ink dark:bg-white dark:text-ink"}`}
            >
              {saving ? "Saving…" : justSaved ? "Saved ✓" : "Save"}
            </button>
            <button
              type="submit"
              // Same form, flagged so the server posts right after saving
              name="intent"
              value="post"
              disabled={saving || !channel.connected}
              title={channel.connected ? undefined : `Connect ${channel.handleDisplay} in Settings to post`}
              className="rounded-full border border-line bg-white/50 px-4 py-2 text-sm font-medium hover:bg-white/80 disabled:opacity-60 dark:bg-white/10"
            >
              Post now
            </button>
          </>
        )}
      </div>

      {!channel.connected && admin && (
        <p className="text-xs text-ink-soft">
          Not connected yet: connect {channel.handleDisplay} in Settings above to post or schedule. You can still save
          the advert.
        </p>
      )}
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
        {result?.ok && result.message && (
          <p role="status" className="font-medium text-emerald-700 dark:text-emerald-300">
            {result.message}
          </p>
        )}
        {result?.ok && result.note && <p className="text-amber-800 dark:text-amber-200">{result.note}</p>}
        {result?.verdict && <Verdict verdict={result.verdict} />}
      </div>
    </form>
  );
}
