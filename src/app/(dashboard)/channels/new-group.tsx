"use client";

import { useState } from "react";
import type { GroupKind } from "@prisma/client";
import { groupNames, groupPlatforms } from "@/lib/handles";
import { createGroup } from "./actions";
import { GroupForm } from "./group-form";

// "Add new": the dropdown lists only containers that don't exist yet (Meta, X, TikTok).
// Choosing Meta then asks which Meta platforms to include.
export function NewGroup({ missing }: { missing: GroupKind[] }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<GroupKind | "">("");

  if (missing.length === 0) return <p className="text-sm text-ink-soft">Every container has been added.</p>;

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setKind("");
        }}
        className="blend-meta rounded-full px-5 py-2.5 font-medium text-white shadow-md shadow-fuchsia-500/25"
      >
        Add new
      </button>
      {open && (
        <div className="glass absolute top-full right-0 z-30 mt-2 w-[min(26rem,calc(100vw-2rem))] rounded-3xl p-5">
          <label htmlFor="new-kind" className="text-sm font-medium">
            Social media
          </label>
          <select
            id="new-kind"
            autoFocus
            value={kind}
            onChange={(e) => setKind(e.target.value as GroupKind)}
            className="mt-1 w-full rounded-xl border border-line bg-white/60 px-3 py-2 dark:bg-white/10"
          >
            <option value="" disabled>
              Choose…
            </option>
            {missing.map((k) => (
              <option key={k} value={k}>
                {groupNames[k]}
                {k === "META" ? " (Facebook, Instagram, WhatsApp)" : ""}
              </option>
            ))}
          </select>
          {kind && (
            <div className="mt-4">
              <GroupForm
                key={kind}
                kind={kind}
                initialPlatforms={kind === "META" ? [] : groupPlatforms[kind]}
                submitLabel="Add container"
                onCancel={() => setOpen(false)}
                onSubmit={async (input) => {
                  const res = await createGroup(input);
                  if (!res?.error) setOpen(false);
                  return res;
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
