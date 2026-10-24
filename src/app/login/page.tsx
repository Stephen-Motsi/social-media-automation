import Link from "next/link";
import { socialProviders } from "@/auth";
import { LoginForm, SignupForm } from "./login-form";
import { socialLogin } from "./actions";

const errors: Record<string, string> = {
  use_password: "That email has a password account. Sign in with your email and password below.",
  disabled: "This account has been disabled.",
  no_email: "Your account didn't share an email address. Allow email access and try again.",
  unverified_email: "Your email isn't verified with that provider. Verify it and try again.",
  OAuthAccountNotLinked: "That email is already linked to a different sign-in method.",
  AccessDenied: "Sign-in was cancelled.",
  Configuration: "Sign-in isn't set up correctly. Try again later.",
};

const BRAND = process.env.BRAND_NAME ?? "Social Automation";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string; expired?: string; mode?: string }>;
}) {
  const { error, callbackUrl, expired, mode } = await searchParams;
  const signup = mode === "signup";
  const base = (process.env.AUTH_URL ?? "").replace(/\/$/, "");
  const path = callbackUrl && base && callbackUrl.startsWith(base + "/") ? callbackUrl.slice(base.length) : callbackUrl;
  const next = path && path.startsWith("/") && !path.startsWith("//") ? path : null;
  const tab = (m: "signin" | "signup") => {
    const q = new URLSearchParams();
    if (m === "signup") q.set("mode", "signup");
    if (next) q.set("callbackUrl", next);
    return `/login${q.size ? `?${q}` : ""}`;
  };
  const google = socialProviders.some((p) => p.id === "google");

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="glass rise w-full max-w-sm rounded-[28px] p-8">
        <Link href="/" className="text-sm font-semibold tracking-tight text-ink-soft hover:text-ink">
          ← {BRAND}
        </Link>
        <div role="tablist" aria-label="Sign in or create an account" className="mt-4 grid grid-cols-2 gap-1 rounded-full border border-line bg-white/30 p-1 dark:bg-white/5">
          {(["signin", "signup"] as const).map((m) => {
            const active = (m === "signup") === signup;
            return (
              <Link
                key={m}
                href={tab(m)}
                role="tab"
                aria-selected={active}
                className={`rounded-full px-3 py-2 text-center text-sm font-medium ${active ? "bg-ink text-white dark:bg-white dark:text-ink" : "text-ink-soft hover:bg-white/50 hover:text-ink dark:hover:bg-white/10"}`}
              >
                {m === "signin" ? "Sign in" : "Create account"}
              </Link>
            );
          })}
        </div>
        <h1 className="mt-6 text-xl font-semibold">{signup ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {signup ? "Subscribe to adverts and get them on WhatsApp, X and Instagram." : "Sign in to manage your adverts."}
        </p>
        {expired && !error && (
          <p role="status" className="mt-3 text-sm text-ink-soft">
            Your session ended (you signed out on another device, or it expired). Sign in again.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {errors[error] ?? "Couldn't sign you in. Try again."}
          </p>
        )}

        <section className="mt-5 space-y-2" aria-label="Continue with an account you already have">
          {socialProviders.map((p) => (
            <form key={p.id} action={socialLogin.bind(null, p.id, next)}>
              <button
                type="submit"
                className={`flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 font-medium ${
                  p.id === "facebook" ? "blend-facebook text-white" : "border border-line bg-white/80 text-ink hover:bg-white dark:bg-white/10 dark:hover:bg-white/15"
                }`}
              >
                {p.id === "google" && <GoogleMark />}
                Continue with {p.name}
              </button>
            </form>
          ))}
          {!google && (
            <p className="rounded-2xl border border-dashed border-line px-3 py-2.5 text-xs text-ink-soft">
              Continue with Google isn&rsquo;t switched on yet. Use your email below.
            </p>
          )}
        </section>

        <div className="my-6 flex items-center gap-3 text-xs text-ink-soft" aria-hidden>
          <span className="h-px flex-1 bg-line" />
          or with email
          <span className="h-px flex-1 bg-line" />
        </div>

        {signup ? <SignupForm callbackUrl={next} /> : <LoginForm callbackUrl={next} />}

        <p className="mt-6 text-center text-sm text-ink-soft">
          {signup ? "Already have an account? " : "New here? "}
          <Link href={tab(signup ? "signin" : "signup")} className="font-medium text-ink underline underline-offset-2">
            {signup ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12s4.3 9.7 9.7 9.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  );
}
