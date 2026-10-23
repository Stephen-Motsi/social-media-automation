"use client";

import { useState, useTransition } from "react";
import { approveCampaign, rejectCampaign, type ApprovalState } from "./actions";

export function Decision({ id, count, admin }: { id: string; count: number; admin: boolean }) {
  const [state, setState] = useState<ApprovalState>();
  const [pending, start] = useTransition();
  if (!admin) return <p className="text-sm text-ink-soft">Waiting for an admin to approve.</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => setState(await approveCampaign(id)))}
          className="blend-whatsapp rounded-full px-5 py-2.5 font-medium text-white shadow-md shadow-emerald-500/25 disabled:opacity-60"
        >
          {pending ? "Working…" : `Approve & send to ${count}`}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (confirm("Reject this advert? It won't be sent, and won't be proposed again.")) {
              start(async () => setState(await rejectCampaign(id)));
            }
          }}
          className="rounded-full px-4 py-2.5 text-sm text-ink-soft hover:bg-danger/10 hover:text-danger"
        >
          Reject
        </button>
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="text-sm text-emerald-700 dark:text-emerald-300">{state.message}</p>}
    </div>
  );
}
