"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { prisma } from "@/lib/db";
import { isStaff } from "@/lib/session";

// Only same-site paths, so a crafted link can't send people elsewhere after signing in.
function safePath(p: FormDataEntryValue | null | string) {
  if (typeof p !== "string") return null;
  // Accept our own absolute URLs (the sign-in redirect adds them) by keeping only the path.
  const base = (process.env.AUTH_URL ?? "").replace(/\/$/, "");
  if (base && p.startsWith(base + "/")) p = p.slice(base.length);
  return p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/\\") ? p : null;
}

export async function login(_prev: string | undefined, formData: FormData) {
  // Where to land after signing in: the admin dashboard for staff, "My adverts" for users.
  const email = String(formData.get("email") ?? "").toLowerCase();
  const role = (await prisma.user.findUnique({ where: { email }, select: { role: true } }))?.role;
  const home = isStaff(role) ? "/admin" : "/me";
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: safePath(formData.get("callbackUrl")) ?? home,
    });
  } catch (err) {
    if (err instanceof AuthError) return "Invalid email or password.";
    throw err; // re-throw the redirect thrown on success
  }
}

export async function socialLogin(provider: string, callbackUrl: string | null) {
  // Social sign-ins are users (a promoted admin sees an Admin link on their dashboard).
  await signIn(provider, { redirectTo: safePath(callbackUrl) ?? "/me" });
}
