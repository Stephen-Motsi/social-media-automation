"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { clientIp, isStaff, logActivity } from "@/lib/session";

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
  const home = isStaff(role) ? "/admin" : "/";
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
  await signIn(provider, { redirectTo: safePath(callbackUrl) ?? "/" });
}

const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80, "Keep your name under 80 characters."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters for your password.").max(200),
});
const SIGNUPS_PER_IP_PER_HOUR = 5;

// Creates a user account (never staff) with email and password, signs it in and opens the home page.
export async function signup(_prev: string | undefined, formData: FormData) {
  const parsed = signupSchema.safeParse({ name: formData.get("name"), email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return parsed.error.issues[0].message;
  const { name, email, password } = parsed.data;

  const ip = await clientIp();
  if (ip) {
    const recent = await prisma.activityLog.count({ where: { action: "SIGN_UP", ip, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
    if (recent >= SIGNUPS_PER_IP_PER_HOUR) return "Too many new accounts from this network. Try again in an hour.";
  }
  const existing = await prisma.user.findUnique({ where: { email }, include: { accounts: { select: { provider: true } } } });
  if (existing?.passwordHash) return "An account with this email already exists. Sign in instead.";
  // Never put a password on an account someone else signs in to with Google.
  if (existing) return `This email signs in with ${existing.accounts[0]?.provider === "facebook" ? "Facebook" : "Google"}. Use that button above.`;

  try {
    const user = await prisma.user.create({ data: { name, email, passwordHash: await bcrypt.hash(password, 12), role: "USER" } });
    await logActivity(user.id, "SIGN_UP", { method: "email" });
  } catch {
    return "Couldn't create your account right now. Try again.";
  }
  try {
    await signIn("credentials", { email, password, redirectTo: safePath(formData.get("callbackUrl")) ?? "/" });
  } catch (err) {
    if (err instanceof AuthError) return "Your account was created, but signing in failed. Sign in below.";
    throw err; // the redirect thrown on success
  }
}
