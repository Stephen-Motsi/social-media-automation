"use client";

import { useActionState, useTransition, useState } from "react";
import { setSubscribed, subscribe, updatePreferences, type SubscribeState } from "./actions";

type Interest = { id: string; name: string };

const field = "mt-1 w-full rounded-xl border border-line bg-white/60 px-3 py-2.5 dark:bg-white/5";

function Topics({ interests, selected = [] }: { interests: Interest[]; selected?: string[] }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">What would you like adverts about?</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {interests.map((i) => (
          <label key={i.id} className="cursor-pointer">
            <input type="checkbox" name="interests" value={i.id} defaultChecked={selected.includes(i.id)} className="peer sr-only" />
            <span className="inline-block rounded-full border border-line px-3.5 py-1.5 text-sm transition-colors peer-checked:border-transparent peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--ig-3)] dark:peer-checked:bg-white dark:peer-checked:text-ink">
              {i.name}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Locations({ locations }: { locations: string[] }) {
  return (
    <datalist id="locations">
      {locations.map((l) => (
        <option key={l} value={l} />
      ))}
    </datalist>
  );
}

export function SubscribeForm({ interests, locations, consentText }: { interests: Interest[]; locations: string[]; consentText: string }) {
  const [state, action, pending] = useActionState(subscribe, undefined);

  if (state?.rejected) {
    return (
      <div className="space-y-3 text-center" role="status">
        <p className="text-2xl font-semibold">We can&rsquo;t subscribe this number</p>
        <p className="text-ink-soft">{state.rejected}</p>
      </div>
    );
  }

  if (state?.existing) {
    return (
      <div className="space-y-4 text-center" role="status">
        <p className="text-2xl font-semibold">This number is already on our list</p>
        <p className="text-ink-soft">
          To change your topics or unsubscribe, message <strong className="text-ink">MANAGE</strong> to us on WhatsApp
          from that number. We&rsquo;ll reply with your personal link.
        </p>
        {state.existing.manageLink && (
          <a href={state.existing.manageLink} className="blend-whatsapp inline-block rounded-full px-5 py-2.5 font-medium text-white">
            Message MANAGE on WhatsApp
          </a>
        )}
      </div>
    );
  }

  if (state?.confirm) {
    return (
      <div className="space-y-4 text-center" role="status">
        <p className="text-sm font-medium text-ink-soft">Step 2 of 2</p>
        <p className="text-2xl font-semibold">Confirm on WhatsApp</p>
        <p className="text-ink-soft">
          Send us the message below from the number you entered. It proves the number is yours, and your subscription
          starts straight away.
        </p>
        <p className="rounded-2xl border border-line bg-white/50 py-3 font-mono text-2xl tracking-widest dark:bg-white/5">
          JOIN {state.confirm.code}
        </p>
        {state.confirm.link ? (
          <a
            href={state.confirm.link}
            className="blend-whatsapp inline-block w-full rounded-full px-5 py-3 font-medium text-white shadow-md shadow-emerald-500/25"
          >
            Open WhatsApp and send
          </a>
        ) : (
          <p className="text-sm text-ink-soft">WhatsApp confirmation isn&rsquo;t available yet. We&rsquo;ll be in touch.</p>
        )}
        <p className="text-xs text-ink-soft">Not confirmed within 7 days? The sign-up is removed.</p>
      </div>
    );
  }

  if (state?.ok) {
    return <p className="text-center text-ink-soft" role="status">{state.message ?? "Thanks!"}</p>;
  }

  return (
    <form action={action} className="space-y-5">
      <label className="block">
        <span className="text-sm font-medium">Your name</span>
        <input name="name" required autoComplete="name" className={field} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">WhatsApp number</span>
        <input name="phone" required type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" className={field} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">
          Town or county <span className="font-normal text-ink-soft">(optional, for local offers)</span>
        </span>
        <input name="location" list="locations" autoComplete="address-level2" placeholder="Nairobi" className={field} />
        <Locations locations={locations} />
      </label>
      <Topics interests={interests} />
      {/* Hidden from people; bots fill it in */}
      <input name="company" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-0 w-0 opacity-0" />
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="consent" required className="mt-0.5 size-4 shrink-0 accent-[var(--ig-3)]" />
        <span>{consentText}</span>
      </label>
      {state?.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="blend-whatsapp w-full rounded-full px-5 py-3 font-medium text-white shadow-md shadow-emerald-500/25 disabled:opacity-60"
      >
        {pending ? "Subscribing…" : "Subscribe on WhatsApp"}
      </button>
    </form>
  );
}

export function ManageForm({
  token,
  interests,
  locations,
  selected,
  location,
  active,
}: {
  token: string;
  interests: Interest[];
  locations: string[];
  selected: string[];
  location: string;
  active: boolean;
}) {
  const [state, action, pending] = useActionState(updatePreferences.bind(null, token), undefined);
  const [toggleState, setToggleState] = useState<SubscribeState>();
  const [toggling, start] = useTransition();
  const result = toggleState ?? state;

  return (
    <div className="space-y-6">
      {active ? (
        <form action={action} className="space-y-5">
          <Topics interests={interests} selected={selected} />
          <label className="block">
            <span className="text-sm font-medium">Town or county</span>
            <input name="location" list="locations" defaultValue={location} className={field} />
            <Locations locations={locations} />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-ink px-5 py-2.5 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-ink"
          >
            {pending ? "Saving…" : "Save preferences"}
          </button>
        </form>
      ) : (
        <p className="text-ink-soft">You&rsquo;re unsubscribed and won&rsquo;t receive adverts.</p>
      )}
      <div className="border-t border-line pt-5">
        <button
          type="button"
          disabled={toggling}
          onClick={() => start(async () => setToggleState(await setSubscribed(token, !active)))}
          className={
            active
              ? "rounded-full px-4 py-2 text-sm text-ink-soft hover:bg-danger/10 hover:text-danger"
              : "blend-whatsapp rounded-full px-5 py-2.5 font-medium text-white"
          }
        >
          {toggling ? "Saving…" : active ? "Unsubscribe from all adverts" : "Subscribe again"}
        </button>
      </div>
      {result?.error && <p role="alert" className="text-sm text-danger">{result.error}</p>}
      {result?.ok && result.message && <p className="text-sm text-emerald-700 dark:text-emerald-300">{result.message}</p>}
    </div>
  );
}
