"use client";

import { useState, useTransition } from "react";
import type { Platform } from "@prisma/client";
import { platforms } from "@/components/platforms";
import { createChannel } from "./actions";

// "Create new" offers only platforms that don't have a container yet.
export function NewChannel({ missing }: { missing: Platform[] }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Platform | "">("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  if (missing.length === 0) {
    return <p className="text-sm text-ink-soft">Every platform has a container.</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setChoice("");
        }}
        className="blend-meta rounded-full px-5 py-2.5 font-medium text-white shadow-md shadow-fuchsia-500/25"
      >
        Create new
      </button>
    );
  }

  return (
    <form
      className="glass flex flex-wrap items-center gap-2 rounded-full py-1.5 pr-1.5 pl-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!choice) return;
        start(async () => {
          const res = await createChannel(choice);
          if (res?.error) setError(res.error);
          else setOpen(false);
        });
      }}
    >
      <label htmlFor="new-platform" className="text-sm text-ink-soft">
        Platform
      </label>
      <select
        id="new-platform"
        autoFocus
        value={choice}
        onChange={(e) => setChoice(e.target.value as Platform)}
        className="rounded-full border border-line bg-white/60 px-3 py-1.5 text-sm dark:bg-white/10"
      >
        <option value="" disabled>
          Choose…
        </option>
        {missing.map((p) => (
          <option key={p} value={p}>
            {platforms[p].name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={!choice || pending}
        className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-ink"
      >
        {pending ? "Adding…" : "Add"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="rounded-full px-3 py-1.5 text-sm text-ink-soft hover:text-ink">
        Cancel
      </button>
      {error && <p className="w-full px-1 text-sm text-danger">{error}</p>}
    </form>
  );
}
