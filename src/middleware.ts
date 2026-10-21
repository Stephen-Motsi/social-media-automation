import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  // Everything except auth endpoints, Meta webhooks, public post images, and static assets requires sign-in.
  matcher: ["/((?!api/auth|api/webhooks|api/media|_next/static|_next/image|favicon.ico).*)"],
};
