"use client";

import { useActionState } from "react";
import { login, signup } from "./actions";
import { keepValues } from "@/lib/keep-form";

export function LoginForm({ callbackUrl }: { callbackUrl?: string | null }) {
  const [error, action, pending] = useActionState(login, undefined);

  return (
    <form onSubmit={keepValues(action)} className="space-y-4">
      {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}
      <label className="block">
        <span className="text-sm font-medium">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-1 w-full rounded-xl border border-line bg-white/50 px-3 py-2 dark:bg-white/5"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mt-1 w-full rounded-xl border border-line bg-white/50 px-3 py-2 dark:bg-white/5"
        />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="blend-meta w-full rounded-full px-3 py-2.5 font-medium text-white shadow-md shadow-fuchsia-500/25"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export function SignupForm({ callbackUrl }: { callbackUrl?: string | null }) {
  const [error, action, pending] = useActionState(signup, undefined);
  const field = "mt-1 w-full rounded-xl border border-line bg-white/50 px-3 py-2 dark:bg-white/5";

  return (
    <form onSubmit={keepValues(action)} className="space-y-4">
      {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}
      <label className="block">
        <span className="text-sm font-medium">Your name</span>
        <input name="name" required minLength={2} maxLength={80} autoComplete="name" className={field} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Email</span>
        <input name="email" type="email" required autoComplete="email" className={field} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Password</span>
        <input name="password" type="password" required minLength={8} autoComplete="new-password" aria-describedby="pw-hint" className={field} />
        <span id="pw-hint" className="mt-1 block text-xs text-ink-soft">At least 8 characters.</span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className="blend-meta w-full rounded-full px-3 py-2.5 font-medium text-white shadow-md shadow-fuchsia-500/25">
        {pending ? "Creating your account…" : "Create account"}
      </button>
    </form>
  );
}
