"use client";

import { useState, useTransition } from "react";
import { approveAdvertReview, approveCampaign, rejectAdvertReview, rejectCampaign, type ApprovalState } from "./actions";

export function AdvertReviewDecision({ id }: { id: string }) {
  const [state, setState] = useState<ApprovalState>();
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => start(async () => setState(await approveAdvertReview(id)))}
          className="blend-whatsapp rounded-full px-5 py-2.5 font-medium text-white shadow-md shadow-emerald-500/25 disabled:opacity-60">
          {pending ? "Working…" : "Approve"}
        </button>
        <button type="button" disabled={pending} onClick={() => setRejecting((value) => !value)}
          className="rounded-full px-4 py-2.5 text-sm text-ink-soft hover:bg-danger/10 hover:text-danger">
          Reject
        </button>
      </div>
      {rejecting && (
        <div className="max-w-xl space-y-2">
          <label htmlFor={`reject-${id}`} className="block text-sm font-medium">Rejection reason</label>
          <textarea id={`reject-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={3}
            className="w-full rounded-2xl border border-line bg-white/60 px-3 py-2 text-sm outline-none focus:border-danger dark:bg-white/5" />
          <button type="button" disabled={pending || !reason.trim()} onClick={() => start(async () => setState(await rejectAdvertReview(id, reason)))}
            className="rounded-full bg-danger px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            Confirm rejection
          </button>
        </div>
      )}
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="text-sm text-emerald-700 dark:text-emerald-300">{state.message}</p>}
    </div>
  );
}

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
