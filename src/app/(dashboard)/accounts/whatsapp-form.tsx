"use client";

import { useActionState, useTransition, useState } from "react";
import { connectWhatsApp, connectWhatsAppFromEnv, type FormState } from "./actions";

const field = "mt-1 w-full rounded-xl border border-line bg-white/50 px-3 py-2 dark:bg-white/5";

export function WhatsAppForm({ envReady }: { envReady: boolean }) {
  const [state, action, pending] = useActionState(connectWhatsApp, undefined);
  const [envState, setEnvState] = useState<FormState>(undefined);
  const [envPending, startEnv] = useTransition();
  const result = envState ?? state;

  return (
    <div className="space-y-4">
      {envReady && (
        <button
          type="button"
          disabled={envPending}
          onClick={() => startEnv(async () => setEnvState(await connectWhatsAppFromEnv()))}
          className="blend-whatsapp rounded-full px-5 py-2.5 font-medium text-white shadow-md shadow-emerald-500/25 disabled:opacity-60"
        >
          {envPending ? "Connecting…" : "Connect the number from server settings"}
        </button>
      )}

      <form action={action} className="space-y-3">
        <p className="text-sm text-ink-soft">
          {envReady ? "Or enter another number's details" : "Enter the details"} from WhatsApp → API Setup in your Meta app.
        </p>
        <label className="block text-sm">
          <span className="font-medium">Phone number ID</span>
          <input name="phoneNumberId" inputMode="numeric" autoComplete="off" required className={field} />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Access token</span>
          <input name="accessToken" type="password" autoComplete="off" required className={field} />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full border border-line bg-white/50 px-5 py-2 font-medium transition-colors hover:bg-white/80 disabled:opacity-60 dark:bg-white/10 dark:hover:bg-white/20"
        >
          {pending ? "Checking with Meta…" : "Connect number"}
        </button>
      </form>

      {result?.error && (
        <p role="alert" className="text-sm text-danger">
          {result.error}
        </p>
      )}
      {result?.ok && <p className="text-sm text-emerald-700 dark:text-emerald-300">{result.message}</p>}
    </div>
  );
}
