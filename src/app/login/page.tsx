import { socialProviders } from "@/auth";
import { LoginForm } from "./login-form";
import { socialLogin } from "./actions";

const errors: Record<string, string> = {
  use_password: "That email belongs to a staff account. Sign in with your email and password below.",
  disabled: "This account has been disabled.",
  no_email: "Your account didn't share an email address. Allow email access and try again.",
  unverified_email: "Your email isn't verified with that provider. Verify it and try again.",
  OAuthAccountNotLinked: "That email is already linked to a different sign-in method.",
  AccessDenied: "Sign-in was cancelled.",
  Configuration: "Sign-in isn't set up correctly. Try again later.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string; expired?: string }>;
}) {
  const { error, callbackUrl, expired } = await searchParams;
  const base = (process.env.AUTH_URL ?? "").replace(/\/$/, "");
  const path = callbackUrl && base && callbackUrl.startsWith(base + "/") ? callbackUrl.slice(base.length) : callbackUrl;
  const next = path && path.startsWith("/") && !path.startsWith("//") ? path : null;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="glass w-full max-w-sm rounded-[28px] p-8">
        <h1 className="text-xl font-semibold">Sign in</h1>
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

        <section className="mt-5" aria-label="Sign in to subscribe">
          <p className="text-sm text-ink-soft">Subscribe to adverts with your Google or Facebook account.</p>
          {socialProviders.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-line px-3 py-2.5 text-xs text-ink-soft">
              Social sign-in isn&rsquo;t set up yet. Meanwhile you can <a href="/subscribe" className="underline">get offers on WhatsApp</a>.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {socialProviders.map((p) => (
                <form key={p.id} action={socialLogin.bind(null, p.id, next)}>
                  <button
                    type="submit"
                    className={`w-full rounded-full px-4 py-2.5 font-medium ${
                      p.id === "facebook" ? "blend-facebook text-white" : "border border-line bg-white/70 text-ink dark:bg-white/10"
                    }`}
                  >
                    Continue with {p.name}
                  </button>
                </form>
              ))}
            </div>
          )}
        </section>

        <section className="mt-8 border-t border-line pt-6" aria-label="Staff sign in">
          <h2 className="text-sm font-semibold">Staff</h2>
          <p className="mt-0.5 mb-4 text-xs text-ink-soft">Access is by invitation.</p>
          <LoginForm callbackUrl={next} />
        </section>
      </div>
    </main>
  );
}
