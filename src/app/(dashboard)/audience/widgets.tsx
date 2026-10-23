"use client";

import { useActionState, useState, useTransition } from "react";
import { addInterest, deleteInterest, deleteSubscriber, saveTemplate, setSubscriberStatus } from "./actions";

const field = "w-full rounded-xl border border-line bg-white/55 px-3 py-2 dark:bg-white/5";

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-xl border border-line bg-white/50 px-3 py-2 text-sm dark:bg-white/5">{url}</code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-ink"
      >
        {copied ? "Copied" : "Copy link"}
      </button>
      <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-full px-3 py-2 text-sm text-ink-soft hover:text-ink">
        Open
      </a>
    </div>
  );
}

export function Topics({ topics, admin }: { topics: { id: string; name: string; count: number }[]; admin: boolean }) {
  const [state, action, pending] = useActionState(addInterest, undefined);
  const [removing, start] = useTransition();
  return (
    <div>
      <ul className="flex flex-wrap gap-2">
        {topics.map((t) => (
          <li key={t.id} className="flex items-center gap-1 rounded-full border border-line bg-white/40 py-1 pr-1 pl-3 text-sm dark:bg-white/5">
            {t.name}
            <span className="text-ink-soft tabular-nums">· {t.count}</span>
            {admin && (
              <button
                type="button"
                disabled={removing}
                aria-label={`Remove ${t.name}`}
                onClick={() => {
                  if (confirm(`Remove the topic "${t.name}"? Subscribers and adverts keep their other topics.`)) {
                    start(async () => void (await deleteInterest(t.id)));
                  }
                }}
                className="ml-1 size-6 rounded-full text-ink-soft hover:bg-danger/10 hover:text-danger"
              >
                ×
              </button>
            )}
          </li>
        ))}
        {topics.length === 0 && <li className="text-sm text-ink-soft">No topics yet. Add some so people can subscribe.</li>}
      </ul>
      {admin && (
        <form action={action} className="mt-3 flex flex-wrap gap-2">
          <input name="name" placeholder="New topic, e.g. Electronics" aria-label="New topic" className={`${field} max-w-xs`} />
          <button type="submit" disabled={pending} className="rounded-full border border-line bg-white/50 px-4 py-2 text-sm font-medium hover:bg-white/80 dark:bg-white/10">
            {pending ? "Adding…" : "Add topic"}
          </button>
          {state?.error && <p role="alert" className="w-full text-sm text-danger">{state.error}</p>}
        </form>
      )}
    </div>
  );
}

export function TemplateForm({ template, lang, admin }: { template: string; lang: string; admin: boolean }) {
  const [state, action, pending] = useActionState(saveTemplate, undefined);
  return (
    <form action={action} className="space-y-3">
      <fieldset disabled={!admin} className="flex flex-wrap gap-3">
        <label className="block min-w-48 flex-1 text-sm">
          <span className="text-xs font-medium">Template name</span>
          <input name="template" defaultValue={template} placeholder="audience_offer" className={field} />
        </label>
        <label className="block w-28 text-sm">
          <span className="text-xs font-medium">Language</span>
          <input name="lang" defaultValue={lang} className={field} />
        </label>
      </fieldset>
      {admin && (
        <button type="submit" disabled={pending} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-ink">
          {pending ? "Saving…" : "Save template"}
        </button>
      )}
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="text-sm text-emerald-700 dark:text-emerald-300">{state.message}</p>}
    </form>
  );
}

export function SubscriberActions({ id, name, active }: { id: string; name: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex justify-end gap-1">
      {active && (
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => void (await setSubscriberStatus(id, false)))}
          className="rounded-full px-2.5 py-1 text-xs text-ink-soft hover:bg-white/50 hover:text-ink dark:hover:bg-white/10"
        >
          Unsubscribe
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm(`Delete ${name}'s data? This can't be undone.`)) start(async () => void (await deleteSubscriber(id)));
        }}
        className="rounded-full px-2.5 py-1 text-xs text-ink-soft hover:bg-danger/10 hover:text-danger"
      >
        Delete
      </button>
    </div>
  );
}
