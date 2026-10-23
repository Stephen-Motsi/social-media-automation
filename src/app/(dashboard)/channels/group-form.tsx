"use client";

import { useState, useTransition } from "react";
import type { GroupKind, Platform } from "@prisma/client";
import { PlatformBadge, platforms } from "@/components/platforms";
import { groupPlatforms, handleLabels } from "@/lib/handles";
import type { GroupInput } from "./actions";
import { field } from "./social-container";

// Choose a container's platforms (Meta only) and the real handle each one posts to.
export function GroupForm({
  kind,
  initialPlatforms,
  initialHandles = {},
  submitLabel,
  onSubmit,
  onCancel,
}: {
  kind: GroupKind;
  initialPlatforms: Platform[];
  initialHandles?: Partial<Record<Platform, string>>;
  submitLabel: string;
  onSubmit: (input: GroupInput) => Promise<{ error?: string; message?: string } | undefined>;
  onCancel: () => void;
}) {
  const available = groupPlatforms[kind];
  const [chosen, setChosen] = useState<Platform[]>(initialPlatforms);
  const [handles, setHandles] = useState<Partial<Record<Platform, string>>>(initialHandles);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const multi = available.length > 1;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(undefined);
        const removed = initialPlatforms.filter((p) => !chosen.includes(p));
        if (
          removed.length &&
          !confirm(
            `Remove ${removed.map((p) => platforms[p].name).join(" and ")}? Its schedule is deleted and its accounts are disconnected.`,
          )
        ) {
          return;
        }
        start(async () => {
          const res = await onSubmit({ kind, platforms: available.filter((p) => chosen.includes(p)), handles });
          if (res?.error) setError(res.error);
        });
      }}
    >
      {multi && <p className="text-sm text-ink-soft">Choose the Meta platforms to include, and the account each one posts to.</p>}
      <div className="space-y-3">
        {available.map((p) => {
          const on = chosen.includes(p);
          const label = handleLabels[p];
          return (
            <div key={p} className={`rounded-2xl border p-3 transition-colors ${on ? "border-line bg-white/45 dark:bg-white/5" : "border-dashed border-line"}`}>
              {multi ? (
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p] : c.filter((x) => x !== p)))}
                    className="size-4 accent-[var(--ig-3)]"
                  />
                  <PlatformBadge platform={p} />
                  <span className="font-medium">{platforms[p].name}</span>
                </label>
              ) : (
                <div className="flex items-center gap-3">
                  <PlatformBadge platform={p} />
                  <span className="font-medium">{platforms[p].name}</span>
                </div>
              )}
              {on && (
                <label className="mt-3 block text-sm">
                  <span className="text-xs font-medium">{label.label}</span>
                  <input
                    value={handles[p] ?? ""}
                    onChange={(e) => setHandles((h) => ({ ...h, [p]: e.target.value }))}
                    placeholder={label.placeholder}
                    autoComplete="off"
                    required
                    aria-label={label.label}
                    className={field}
                  />
                  <span className="mt-1 block text-xs text-ink-soft">{label.hint}</span>
                </label>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || chosen.length === 0}
          className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-ink"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded-full px-4 py-2 text-sm text-ink-soft hover:text-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}
