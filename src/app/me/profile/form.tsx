"use client";

import { useActionState, useState } from "react";
import type { Platform } from "@prisma/client";
import { PlatformBadge, platforms } from "@/components/platforms";
import { updateProfile } from "../actions";

export type ProfileField = { platform: Platform; value: string; placeholder: string; how: string; delivers: boolean; link?: { href: string; label: string } };

const field = "mt-1 w-full rounded-xl border border-line bg-white/55 px-3 py-2 placeholder:text-ink-soft/60 dark:bg-white/5";

export function ProfileForm({ name, email, socials, autoSubscribe }: { name: string; email: string; socials: ProfileField[]; autoSubscribe: boolean }) {
  const [state, action, pending] = useActionState(updateProfile, undefined);
  const invalid = (f: string) => (state?.field === f ? true : undefined);
  // Controlled, so what was typed stays after a "Not saved" (React resets uncontrolled form fields)
  const [values, setValues] = useState<Record<string, string>>(() => ({ name, ...Object.fromEntries(socials.map((s) => [s.platform, s.value])) }));
  const [consent, setConsent] = useState(false);
  const [auto, setAuto] = useState(autoSubscribe);
  const bind = (key: string) => ({ name: key, value: values[key] ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [key]: e.target.value })) });

  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">Name</span>
          <input {...bind("name")} required minLength={2} maxLength={80} autoComplete="name" aria-invalid={invalid("name")} className={field} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input value={email} readOnly aria-readonly className={`${field} text-ink-soft`} />
        </label>
      </div>

      <fieldset className="space-y-3">
        <legend className="font-semibold">My socials</legend>
        <p className="text-sm text-ink-soft">Handle or profile link. When you subscribe to an advert on a platform, it&rsquo;s sent to your account there where the platform allows it.</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {socials.map((s) => (
            <li key={s.platform} className="lift rounded-2xl border border-line bg-white/30 p-4 dark:bg-white/[0.03]">
              <label className="block">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <PlatformBadge platform={s.platform} />
                  {platforms[s.platform].name}
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${s.delivers ? "bg-wa/15 text-emerald-700 dark:text-emerald-300" : "bg-ink/10 text-ink-soft"}`}>
                    {s.delivers ? "Sent to you" : "Posted on our page"}
                  </span>
                </span>
                <input {...bind(s.platform)} placeholder={s.placeholder} aria-invalid={invalid(s.platform)} aria-describedby={`how-${s.platform}`} className={field} />
              </label>
              <p id={`how-${s.platform}`} className="mt-2 text-xs text-ink-soft">
                {s.how}
                {s.link && (
                  <>
                    {" "}
                    <a href={s.link.href} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline underline-offset-2">
                      {s.link.label}
                    </a>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      </fieldset>

      <label className="flex items-start gap-2 rounded-2xl border border-line bg-white/30 p-4 text-sm dark:bg-white/[0.03]">
        <input type="checkbox" name="autoSubscribe" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="mt-0.5 size-4 accent-[var(--ig-3)]" />
        <span>
          <span className="font-medium">Subscribe me to every new advert</span>
          <span className="block text-xs text-ink-soft">New adverts are sent to the accounts above automatically, as soon as they&rsquo;re published. You can unsubscribe from any of them.</span>
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-invalid={invalid("consent")} className="mt-0.5 size-4 accent-[var(--ig-3)]" />
        <span>These are my own accounts, and I agree to receive the adverts I subscribe to there. I can remove a handle or unsubscribe any time.</span>
      </label>

      <div className="flex flex-wrap items-center gap-3" aria-live="polite">
        <button type="submit" disabled={pending} className="blend-meta rounded-full px-6 py-2.5 font-medium text-white shadow-md shadow-fuchsia-500/25">
          {pending ? "Saving…" : "Save profile"}
        </button>
        {state?.error && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}
        {state?.ok && (
          <p role="status" className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
