import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  // Public marketing and authentication routes are allowlisted in auth.config.ts.
  // Everything else requires a signed-in session, with page-level role checks for staff routes.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
