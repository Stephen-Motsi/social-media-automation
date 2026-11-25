"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkWhatsappRequest, startWhatsappRequest } from "./actions";

type Request = { id: string; status: string; qrExpiresAt: string | null; error: string | null; user: { name: string | null; email: string; whatsappSession: { status: string } | null } };

export function RequestsPanel({ requests }: { requests: Request[] }) {
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      try { setMessage((await action()).message); router.refresh(); }
      catch { setMessage("The operation failed. Please try again."); }
    });
  }
  return (
    <div className="space-y-3">
      {message && <p role="status">{message}</p>}
      {requests.length === 0 && <p>No WhatsApp requests.</p>}
      {requests.map((request) => (
        <section key={request.id} className="glass space-y-2 rounded-2xl p-5">
          <h2 className="font-semibold">{request.user.name || request.user.email}</h2>
          <p className="text-sm">{request.user.email} · Request: {request.status} · WAHA: {request.user.whatsappSession?.status ?? "NOT CREATED"}</p>
          {request.qrExpiresAt && <p className="text-sm">QR window ends {new Date(request.qrExpiresAt).toLocaleString()}</p>}
          {request.error && <p className="text-sm">{request.error}</p>}
          <div className="flex flex-wrap gap-3">
            {["PENDING", "PREPARING", "IN_PROGRESS", "EXPIRING", "EXPIRED", "FAILED"].includes(request.status) && <button disabled={pending} onClick={() => run(() => startWhatsappRequest(request.id))} className="rounded-lg border border-line px-3 py-2">Start or refresh QR</button>}
            {["IN_PROGRESS", "CONNECTED"].includes(request.status) && <button disabled={pending} onClick={() => run(() => checkWhatsappRequest(request.id))} className="rounded-lg border border-line px-3 py-2">Check session</button>}
          </div>
        </section>
      ))}
    </div>
  );
}
