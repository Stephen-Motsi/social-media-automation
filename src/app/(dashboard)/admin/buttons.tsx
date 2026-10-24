"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postNow, publish, unlist, setRole, signOutEverywhere, type AdminState } from "./actions";

function useAction() {
  const [state, setState] = useState<AdminState>();
  const [pending, start] = useTransition();
  return { state, pending, run: (fn: () => Promise<AdminState>) => start(async () => setState(await fn())) };
}

function Feedback({ state }: { state: AdminState }) {
  if (state?.error) return <span role="alert" className="text-xs text-danger">{state.error}</span>;
  if (state?.message) return <span className="text-xs text-emerald-700 dark:text-emerald-300">{state.message}</span>;
  return null;
}

const ghost = "rounded-full border border-line bg-white/50 px-3 py-1.5 text-xs font-medium hover:bg-white/80 disabled:opacity-50 dark:bg-white/10";

export function AdvertButtons({ id, listed }: { id: string; listed: boolean }) {
  const { state, pending, run } = useAction();
  const router = useRouter();
  const publishNow = () =>
    run(async () => {
      const res = await publish(id);
      if (!res.ok) return { error: `Not published: ${res.error}` };
      router.push(`/?published=${id}#published`);
      return { ok: true, message: "Published." };
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={`/create?id=${id}`} className={ghost}>
        {listed ? "Edit" : "Edit draft"}
      </a>
      {listed ? (
        <>
          <button type="button" disabled={pending} onClick={() => run(() => postNow(id))} className={ghost}>
            Post to platforms again now
          </button>
          <button type="button" disabled={pending} onClick={() => confirm("Unlist this advert? Anything scheduled that hasn't gone out is cancelled.") && run(() => unlist(id))} className="rounded-full px-3 py-1.5 text-xs text-ink-soft hover:text-danger">
            Unlist
          </button>
        </>
      ) : (
        <>
          <button type="button" disabled={pending} onClick={publishNow} className="blend-meta rounded-full px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            {pending ? "Publishing…" : "Publish now"}
          </button>
          <a href={`/create?id=${id}&schedule=1`} className={ghost}>
            Schedule…
          </a>
        </>
      )}
      <Feedback state={state} />
    </div>
  );
}

export function SignOutEverywhere({ userId }: { userId: string }) {
  const { state, pending, run } = useAction();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => confirm("Sign this person out on every device?") && run(() => signOutEverywhere(userId))}
        className={ghost}
      >
        Sign out everywhere
      </button>
      <Feedback state={state} />
    </span>
  );
}

export function RoleButton({ userId, role, name }: { userId: string; role: "USER" | "ADMIN"; name: string }) {
  const { state, pending, run } = useAction();
  const promote = role === "USER";
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          confirm(promote ? `Make ${name} an admin? They'll be able to manage adverts, channels and users.` : `Remove ${name}'s admin access?`) &&
          run(() => setRole(userId, promote ? "ADMIN" : "USER"))
        }
        className={promote ? "blend-meta rounded-full px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-50" : ghost}
      >
        {promote ? "Make admin" : "Demote to user"}
      </button>
      <Feedback state={state} />
    </span>
  );
}
