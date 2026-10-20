import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="mt-1 mb-6 text-sm text-neutral-500">
          Access is by invitation. Ask an admin for an account.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
