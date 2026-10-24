"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { homeUrl, STILL_POSTING, waitUntilPosted } from "./publish-progress";
import { postNow, publish, unlist, type PublishState, setRole, signOutEverywhere, type AdminState } from "./actions";

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

type Phase = "idle" | "posting" | "posted" | "done";

// Post now / Publish now: "Posting…" until the platforms confirm, "Posted" on success, then the
// advert on the home page. Anything that didn't go out stays here with the reason.
function PostButton({ id, label, task, className }: { id: string; label: string; task: () => Promise<PublishState>; className: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [problems, setProblems] = useState<string[]>([]);
  const go = async () => {
    setPhase("posting");
    setProblems([]);
    try {
      const res = await task();
      if (!res.ok) {
        setProblems([`Not posted: ${res.error}`]);
        return setPhase("idle");
      }
      const { outcomes, timedOut } = await waitUntilPosted(id);
      const failed = [...res.outcomes, ...outcomes].filter((o) => !o.ok).map((o) => o.message);
      if (timedOut) failed.push(STILL_POSTING);
      if (failed.length) {
        setProblems([...new Set(failed)]);
        return setPhase(outcomes.some((o) => o.ok && !o.pending) ? "done" : "idle");
      }
      setPhase("posted");
      setTimeout(() => router.push(homeUrl(id)), 1200);
    } catch {
      setProblems(["Not posted: the server didn't respond. Check your connection and try again."]);
      setPhase("idle");
    }
  };
  return (
    <>
      <button type="button" disabled={phase !== "idle"} onClick={go} aria-live="polite" className={phase === "posted" || phase === "done" ? "rounded-full bg-wa px-3.5 py-1.5 text-xs font-medium text-white" : className}>
        {phase === "posting" ? "Posting…" : phase === "posted" ? "Posted ✓" : phase === "done" ? "Posted (not everywhere)" : label}
      </button>
      {problems.length > 0 && (
        <span role="alert" className="basis-full space-y-0.5 text-xs text-danger">
          {problems.map((p) => (
            <span key={p} className="block">{p}</span>
          ))}
          {phase === "done" && (
            <a href={homeUrl(id)} className="block font-medium text-ink underline underline-offset-2">
              See it on the home page
            </a>
          )}
        </span>
      )}
    </>
  );
}

export function AdvertButtons({ id, listed }: { id: string; listed: boolean }) {
  const { state, pending, run } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={`/create?id=${id}`} className={ghost}>
        {listed ? "Edit" : "Edit draft"}
      </a>
      {listed ? (
        <>
          <PostButton id={id} label="Post to platforms again now" task={() => postNow(id)} className={ghost} />
          <button type="button" disabled={pending} onClick={() => confirm("Unlist this advert? Anything scheduled that hasn't gone out is cancelled.") && run(() => unlist(id))} className="rounded-full px-3 py-1.5 text-xs text-ink-soft hover:text-danger">
            Unlist
          </button>
        </>
      ) : (
        <>
          <PostButton id={id} label="Post now" task={() => publish(id)} className="blend-meta rounded-full px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-50" />
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
