import type { NextAuthConfig } from "next-auth";

// Edge-safe config (no Prisma/bcrypt) shared by middleware and the full auth setup.
// Middleware only does coarse routing from the signed token; every page and action re-checks
// the session and role against the database on the server (src/lib/session.ts).

const PUBLIC = [/^\/$/, /^\/subscribe(\/|$)/, /^\/login$/, /^\/api\/auth\//, /^\/api\/webhooks\//, /^\/api\/media\//];
export const STAFF_ROLES = ["ADMIN", "SUPER_ADMIN"];

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const path = nextUrl.pathname;
      const role = (auth?.user as { role?: string } | undefined)?.role;
      const signedIn = !!auth?.user;
      // Only used to pick a starting page after sign-in; access itself is checked on the server.
      const home = role && STAFF_ROLES.includes(role) ? "/admin" : "/me";

      // ?expired=1: the cookie is signed but its session was revoked, so show the sign-in page.
      if (path === "/login") return signedIn && !nextUrl.searchParams.has("expired") ? Response.redirect(new URL(home, nextUrl)) : true;
      if (PUBLIC.some((r) => r.test(path))) return true;
      // Signed-out people go to /login. Who may see staff pages is decided on the server from the
      // current role in the database (pageViewer/requireStaff), so promotions and demotions apply
      // immediately rather than when the cookie's copy of the role is refreshed.
      return signedIn;
    },
    jwt({ token }) {
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
