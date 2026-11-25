"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Platform } from "@prisma/client";
import { checkOwnedAccount, disconnectOwnedAccount, disconnectOwnedWhatsapp, getOwnedWhatsappStatus, requestWhatsapp, saveAccountHandle } from "./actions";
import type { AssistedWhatsappView } from "@/lib/whatsapp-requests";

type Account = { id: string; platform: Platform; displayName: string; handle: string | null; tokenExpiresAt: string | null; disconnectedAt: string | null };
type Channel = { platform: Platform; handle: string | null };
const platforms = [
  { id: "FACEBOOK", label: "Facebook Page", href: "/api/meta/connect?scope=personal" },
  { id: "INSTAGRAM", label: "Instagram professional account", href: "/api/meta/connect?scope=personal" },
  { id: "X", label: "X", href: "/api/x/connect?scope=personal" },
  { id: "TIKTOK", label: "TikTok", href: "/api/tiktok/connect?scope=personal" },
] as const;

export function AccountsPanel({ accounts, channels, staffDirectWhatsapp }: { accounts: Account[]; channels: Channel[]; staffDirectWhatsapp: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [whatsapp, setWhatsapp] = useState<AssistedWhatsappView | null>(null);
  const [now, setNow] = useState(Date.now());
  const poll = useCallback(async () => {
    try { setWhatsapp(await getOwnedWhatsappStatus()); }
    catch { setMessage("Could not check WhatsApp status. Try again."); }
    setNow(Date.now());
  }, []);
  useEffect(() => {
    if (staffDirectWhatsapp) return;
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 8000);
    return () => window.clearInterval(timer);
  }, [poll, staffDirectWhatsapp]);
  useEffect(() => {
    if (!whatsapp?.qrExpiresAt) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, new Date(whatsapp.qrExpiresAt).getTime() - Date.now()));
    return () => window.clearTimeout(timer);
  }, [whatsapp?.qrExpiresAt]);

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      try {
        const result = await action();
        setMessage(result.message);
        router.refresh();
        if (!staffDirectWhatsapp) await poll();
      } catch {
        setMessage("The operation failed. Please try again.");
      }
    });
  }
  return (
    <div className="space-y-4">
      {message && <p role="status" className="rounded-xl border border-line p-3">{message}</p>}
      {platforms.map(({ id, label, href }) => {
        const matches = accounts.filter((a) => a.platform === id);
        return (
          <section key={id} className="glass space-y-3 rounded-3xl p-6">
            <h2 className="text-lg font-semibold">{label}</h2>
            <form action={(form) => run(() => saveAccountHandle(id, String(form.get("handle") ?? "")))} className="flex flex-wrap gap-2">
              <label className="sr-only" htmlFor={`handle-${id}`}>{label} handle</label>
              <input id={`handle-${id}`} name="handle" defaultValue={channels.find((c) => c.platform === id)?.handle ?? ""} placeholder="Handle, Page name or profile URL" required className="min-w-52 rounded-lg border border-line bg-transparent px-3 py-2" />
              <button disabled={pending} className="rounded-lg border border-line px-3 py-2">Save handle</button>
              <a href={href} className="rounded-lg bg-ink px-3 py-2 text-white">Sign in to connect or reconnect</a>
            </form>
            {matches.length === 0 && <p className="text-sm text-ink-soft">No connected account. Save the handle before signing in.</p>}
            {matches.map((account) => (
              <div key={account.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span>{account.displayName}{account.handle ? ` (${account.handle})` : ""}</span>
                <span>{account.disconnectedAt ? "Disconnected" : account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() <= now ? "Token expired; check or reconnect" : "Authorization not recently verified"}</span>
                {!account.disconnectedAt && <>
                  <button disabled={pending} onClick={() => run(() => checkOwnedAccount(account.id))} className="underline">Check authorization</button>
                  <button disabled={pending} onClick={() => run(() => disconnectOwnedAccount(account.id))} className="underline">Disconnect</button>
                </>}
              </div>
            ))}
          </section>
        );
      })}
      <section className="glass space-y-3 rounded-3xl p-6">
        <h2 className="text-lg font-semibold">WhatsApp</h2>
        {staffDirectWhatsapp ? <p className="text-sm text-ink-soft">Manage your own WhatsApp session on <Link href="/channels" className="underline">Channels</Link>.</p> : <>
        <p className="text-sm text-ink-soft">An administrator starts your private QR session. Only you can see your QR code.</p>
        <p>Status: {whatsapp?.status.replaceAll("_", " ") ?? "Checking..."}</p>
        {whatsapp?.message && <p role="status">{whatsapp.message}</p>}
        {whatsapp?.account && <p>{whatsapp.account}{whatsapp.phone ? ` (+${whatsapp.phone})` : ""}</p>}
        {whatsapp?.qr && whatsapp.qrExpiresAt && new Date(whatsapp.qrExpiresAt).getTime() > now && (
          <div>
            {/* The QR is supplied as a data URL by the authenticated WAHA session. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={whatsapp.qr} alt="Your WhatsApp connection QR code" width={250} height={250} />
            <p className="text-sm">Scan before {new Date(whatsapp.qrExpiresAt).toLocaleTimeString()}.</p>
          </div>
        )}
        {whatsapp && ["NOT_REQUESTED", "FAILED", "CANCELLED"].includes(whatsapp.status) && <button disabled={pending} onClick={() => run(requestWhatsapp)} className="rounded-lg border border-line px-3 py-2">Request connection</button>}
        {whatsapp && ["CONNECTED", "CONNECTION_ERROR"].includes(whatsapp.status) && <button disabled={pending} onClick={() => run(disconnectOwnedWhatsapp)} className="rounded-lg border border-line px-3 py-2">Disconnect WhatsApp</button>}
        {whatsapp?.status === "EXPIRED" && <p>Ask an administrator to refresh your request.</p>}
        </>}
      </section>
    </div>
  );
}
