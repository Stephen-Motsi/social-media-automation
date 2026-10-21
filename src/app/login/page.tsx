import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="glass w-full max-w-sm rounded-[28px] p-8">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="mt-1 mb-6 text-sm text-ink-soft">
          Access is by invitation. Ask an admin for an account.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
