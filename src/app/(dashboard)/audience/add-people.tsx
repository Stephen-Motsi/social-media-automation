"use client";

import { useActionState, useState, useTransition } from "react";
import { CONSENT_METHODS } from "@/lib/consent";
import { addSubscriber, decideSubscriber, importSubscribers, recheckSubscriber, type AddResult, type AudienceState } from "./actions";

const field = "w-full rounded-xl border border-line bg-white/55 px-3 py-2 dark:bg-white/5";
type Topic = { id: string; name: string };

function TopicPicker({ topics, label }: { topics: Topic[]; label: string }) {
  return (
    <fieldset>
      <legend className="text-xs font-medium">{label}</legend>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {topics.map((t) => (
          <label key={t.id} className="cursor-pointer">
            <input type="checkbox" name="interests" value={t.id} className="peer sr-only" />
            <span className="inline-block rounded-full border border-line px-3 py-1 text-sm peer-checked:border-transparent peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--ig-3)] dark:peer-checked:bg-white dark:peer-checked:text-ink">
              {t.name}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// WhatsApp requires the business to have the person's opt-in; admins record how they got it.
function ConsentFields() {
  const [method, setMethod] = useState("");
  return (
    <div className="space-y-2 rounded-2xl border border-line bg-white/30 p-3 dark:bg-white/[0.03]">
      <label className="block text-sm">
        <span className="text-xs font-medium">How did they agree to receive adverts on WhatsApp?</span>
        <select name="consentMethod" required value={method} onChange={(e) => setMethod(e.target.value)} className={field}>
          <option value="" disabled>
            Choose…
          </option>
          {CONSENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-xs font-medium">Details {method === "Other" ? "" : "(optional)"}</span>
        <input name="consentNote" required={method === "Other"} placeholder="e.g. Westlands shop sign-up sheet, 20 Oct" className={field} />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="attest" required className="mt-0.5 size-4 accent-[var(--ig-3)]" />
        <span>I confirm they agreed to receive adverts from us on WhatsApp.</span>
      </label>
    </div>
  );
}

function Result({ state }: { state: AddResult }) {
  if (!state) return null;
  if (state.error) return <p role="alert" className="text-sm text-danger">{state.error}</p>;
  if (state.summary) {
    const s = state.summary;
    return (
      <div className="text-sm" role="status">
        <p className="text-emerald-700 dark:text-emerald-300">
          {s.added} accepted automatically · {s.review} waiting for review · {s.rejected} rejected by checks · {s.skipped.length} skipped
        </p>
        {s.skipped.length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-ink-soft">
            {s.skipped.slice(0, 20).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">{state.message}</p>;
}

export function AddPeople({ topics }: { topics: Topic[] }) {
  const [mode, setMode] = useState<"one" | "many">("one");
  const [oneState, oneAction, onePending] = useActionState(addSubscriber, undefined);
  const [manyState, manyAction, manyPending] = useActionState(importSubscribers, undefined);
  const tab = (m: typeof mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => setMode(m)}
      className={`rounded-full px-4 py-1.5 text-sm ${mode === m ? "bg-ink text-white dark:bg-white dark:text-ink" : "text-ink-soft hover:text-ink"}`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div role="tablist" className="flex gap-1">
        {tab("one", "One person")}
        {tab("many", "Many at once")}
      </div>
      {mode === "one" ? (
        <form action={oneAction} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm">
              <span className="text-xs font-medium">Name</span>
              <input name="name" required className={field} />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium">WhatsApp number</span>
              <input name="phone" required inputMode="tel" placeholder="0712 345 678" className={field} />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium">Town (optional)</span>
              <input name="location" className={field} />
            </label>
          </div>
          <TopicPicker topics={topics} label="Topics" />
          <ConsentFields />
          <button type="submit" disabled={onePending} className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-ink">
            {onePending ? "Adding…" : "Add person"}
          </button>
          <Result state={oneState} />
        </form>
      ) : (
        <form action={manyAction} className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="text-xs font-medium">One person per line: Name, phone, town, topics (topics separated by ;)</span>
            <textarea
              name="rows"
              rows={6}
              required
              placeholder={"Wanjiku Kamau, 0712 345 678, Nairobi, Electronics; Fashion\nOtieno Ochieng, +254 722 000 111, Kisumu"}
              className={`${field} font-mono text-xs`}
            />
          </label>
          <TopicPicker topics={topics} label="Topics for lines that don't list any" />
          <ConsentFields />
          <button type="submit" disabled={manyPending} className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-ink">
            {manyPending ? "Adding…" : "Add everyone"}
          </button>
          <Result state={manyState} />
        </form>
      )}
    </div>
  );
}

export function ReviewDecision({ id }: { id: string }) {
  const [state, setState] = useState<AudienceState>();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setState(await decideSubscriber(id, true)))}
        className="blend-whatsapp rounded-full px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
      >
        Approve
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setState(await decideSubscriber(id, false)))}
        className="rounded-full px-3 py-1.5 text-sm text-ink-soft hover:bg-danger/10 hover:text-danger"
      >
        Reject
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setState(await recheckSubscriber(id)))}
        className="rounded-full px-3 py-1.5 text-sm text-ink-soft hover:text-ink"
      >
        Check again
      </button>
      {state?.error && <span role="alert" className="text-sm text-danger">{state.error}</span>}
      {state?.ok && <span className="text-sm text-emerald-700 dark:text-emerald-300">{state.message}</span>}
    </div>
  );
}
