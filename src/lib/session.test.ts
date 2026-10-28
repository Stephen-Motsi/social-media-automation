import {
  AccessError,
  requireAuthenticatedViewer,
  requireStaffViewer,
  requireSuperAdminViewer,
  type Viewer,
} from "@/lib/session";

let fails = 0;
function expect(name: string, callback: () => unknown, want: unknown) {
  try {
    const got = callback();
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  } catch (error) {
    const got = error instanceof AccessError ? { name: "AccessError", message: error.message } : error;
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  }
}

const viewer = (role: Viewer["role"]): Viewer => ({
  id: "database-user-id",
  email: "person@example.test",
  name: null,
  image: null,
  role,
  sessionId: "database-session-id",
});
const accessError = (message: string) => ({ name: "AccessError", message });

expect("unauthenticated viewer is rejected", () => requireAuthenticatedViewer(null), accessError("Please sign in again."));
expect(
  "ordinary user is rejected from super-admin operations",
  () => requireSuperAdminViewer(viewer("USER")),
  accessError("Only the super admin can do this."),
);
expect("admin is rejected from super-admin operations", () => requireSuperAdminViewer(viewer("ADMIN")), accessError("Only the super admin can do this."));
expect("super admin is accepted", () => requireSuperAdminViewer(viewer("SUPER_ADMIN")), viewer("SUPER_ADMIN"));
expect("admin is accepted for staff operations", () => requireStaffViewer(viewer("ADMIN")), viewer("ADMIN"));
expect("super admin is accepted for staff operations", () => requireStaffViewer(viewer("SUPER_ADMIN")), viewer("SUPER_ADMIN"));
expect("ordinary user is rejected from staff operations", () => requireStaffViewer(viewer("USER")), accessError("Only admins can do this."));
expect(
  "missing identity is rejected even when a super-admin role is supplied",
  () => requireSuperAdminViewer({ role: "SUPER_ADMIN" }),
  accessError("Please sign in again."),
);
expect(
  "missing session identity is rejected even when a super-admin role is supplied",
  () => requireSuperAdminViewer({ ...viewer("SUPER_ADMIN"), sessionId: "" }),
  accessError("Please sign in again."),
);
expect(
  "unknown privilege claim is rejected",
  () => requireSuperAdminViewer({ ...viewer("USER"), role: "ROOT" }),
  accessError("Please sign in again."),
);
expect(
  "unauthenticated and insufficient-access errors expose only safe messages",
  () => requireSuperAdminViewer({ ...viewer("USER"), email: "" }),
  accessError("Please sign in again."),
);

process.exit(fails ? 1 : 0);
