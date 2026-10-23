import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Facebook from "next-auth/providers/facebook";
import type { Provider } from "next-auth/providers";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { headers } from "next/headers";
import { authConfig } from "./auth.config";
import { prisma } from "@/lib/db";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const SESSION_DAYS = 30;
// How often "last seen" is written for an active session
const TOUCH_EVERY_MS = 60 * 1000;

async function requestInfo() {
  try {
    const h = await headers();
    return {
      ip: h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}

// Social logins for users. Each is enabled when its keys are in .env.
const providers: Provider[] = [
  // Staff: email + password (no sign-up; accounts are created by admins)
  Credentials({
    credentials: { email: {}, password: {} },
    async authorize(raw) {
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return null;
      const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
      if (!user?.passwordHash || user.disabledAt) return null;
      const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
      return ok ? { id: user.id, email: user.email, name: user.name } : null;
    },
  }),
];
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) providers.push(Google);
if (process.env.AUTH_FACEBOOK_ID && process.env.AUTH_FACEBOOK_SECRET) providers.push(Facebook);
// Test-only OAuth provider (see README "Testing social login"). Never set MOCK_OAUTH_URL in production.
if (process.env.MOCK_OAUTH_URL && process.env.NODE_ENV !== "production") {
  const base = process.env.MOCK_OAUTH_URL.replace(/\/$/, "");
  providers.push({
    id: "mock",
    name: "Test login",
    type: "oauth",
    clientId: "mock-client",
    clientSecret: "mock-secret",
    authorization: { url: `${base}/authorize`, params: { scope: "openid email profile" } },
    token: `${base}/token`,
    userinfo: `${base}/userinfo`,
    checks: ["state", "pkce"],
    profile: (p: { sub: string; name: string; email: string; picture?: string; email_verified?: boolean }) => ({
      id: p.sub,
      name: p.name,
      email: p.email,
      image: p.picture,
    }),
  });
}

// For the sign-in buttons
export const socialProviders = [
  ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET ? [{ id: "google", name: "Google" }] : []),
  ...(process.env.AUTH_FACEBOOK_ID && process.env.AUTH_FACEBOOK_SECRET ? [{ id: "facebook", name: "Facebook" }] : []),
  ...(process.env.MOCK_OAUTH_URL && process.env.NODE_ENV !== "production" ? [{ id: "mock", name: "Test login" }] : []),
];

const config: NextAuthConfig = {
  ...authConfig,
  providers,
  callbacks: {
    ...authConfig.callbacks,

    // Social sign-in: find or create the user. Never attach a social login to a staff
    // (password) account by email alone; that would let anyone with that email take it over.
    async signIn({ user, account, profile }) {
      if (!account || account.type === "credentials") return true;
      const email = (user.email ?? profile?.email ?? "").toLowerCase();
      if (!email) return "/login?error=no_email";
      const linked = await prisma.account.findUnique({
        where: { provider_providerAccountId: { provider: account.provider, providerAccountId: account.providerAccountId } },
        include: { user: true },
      });
      if (linked) return linked.user.disabledAt ? "/login?error=disabled" : true;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing?.passwordHash) return "/login?error=use_password";
      if (existing?.disabledAt) return "/login?error=disabled";
      const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified !== false;
      if (existing && !verified) return "/login?error=unverified_email";

      const u = existing ?? (await prisma.user.create({ data: { email, name: user.name, image: user.image, role: "USER" } }));
      await prisma.account.create({
        data: { provider: account.provider, providerAccountId: account.providerAccountId, userId: u.id },
      });
      return true;
    },

    // On sign-in: open a session record and put its ID in the signed cookie.
    async jwt({ token, user, account }) {
      if (user && account) {
        const dbUser =
          account.type === "credentials"
            ? await prisma.user.findUniqueOrThrow({ where: { id: user.id! } })
            : (
                await prisma.account.findUniqueOrThrow({
                  where: { provider_providerAccountId: { provider: account.provider, providerAccountId: account.providerAccountId } },
                  include: { user: true },
                })
              ).user;
        const info = await requestInfo();
        const session = await prisma.userSession.create({
          data: {
            userId: dbUser.id,
            provider: account.provider,
            ...info,
            expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
          },
        });
        await prisma.activityLog.create({
          data: { userId: dbUser.id, action: "SIGN_IN", detail: { provider: account.provider }, ip: info.ip },
        });
        return { ...token, id: dbUser.id, role: dbUser.role, sid: session.id, sub: dbUser.id, name: dbUser.name, email: dbUser.email };
      }
      return token;
    },

    // Every server-side read of the session is checked against the database: the session
    // must exist, not be revoked or expired, and the user must not be disabled. The role is
    // always the current one, so promotions and demotions apply immediately.
    async session({ session, token }) {
      const sid = token.sid as string | undefined;
      const record = sid ? await prisma.userSession.findUnique({ where: { id: sid }, include: { user: true } }) : null;
      const valid = record && !record.revokedAt && record.expiresAt > new Date() && !record.user.disabledAt && record.userId === token.id;
      if (!valid) return { expires: new Date(0).toISOString() } as typeof session;
      if (Date.now() - record.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
        await prisma.userSession.update({ where: { id: record.id }, data: { lastSeenAt: new Date() } });
      }
      session.user = {
        ...session.user,
        id: record.user.id,
        email: record.user.email,
        name: record.user.name,
        image: record.user.image,
        role: record.user.role,
        sessionId: record.id,
      } as typeof session.user;
      return session;
    },
  },
  events: {
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      const sid = token?.sid as string | undefined;
      if (!sid) return;
      const s = await prisma.userSession.updateMany({ where: { id: sid, revokedAt: null }, data: { revokedAt: new Date() } });
      if (s.count && token?.id) {
        await prisma.activityLog.create({ data: { userId: token.id as string, action: "SIGN_OUT", ip: (await requestInfo()).ip } });
      }
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);
