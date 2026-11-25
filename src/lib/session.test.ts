import {
  AccessError,
  requireAuthenticatedViewer,
  requireOwnedRecord,
  requireStaffViewer,
  requireSuperAdminViewer,
  type Viewer,
} from "@/lib/session";
import { canPublishToAccount } from "@/lib/ownership";

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
expect("ordinary user can access their own record", () => requireOwnedRecord(viewer("USER"), "database-user-id"), undefined);
expect("ordinary user cannot access another user's record", () => requireOwnedRecord(viewer("USER"), "another-user"), accessError("Record not found."));
expect("ordinary user cannot access a legacy shared record", () => requireOwnedRecord(viewer("USER"), null), accessError("Record not found."));
expect("admin can access legacy records", () => requireOwnedRecord(viewer("ADMIN"), null), undefined);
expect("super admin can access another user's record", () => requireOwnedRecord(viewer("SUPER_ADMIN"), "another-user"), undefined);
expect("user can publish to their own account", () => canPublishToAccount(viewer("USER"), "database-user-id"), true);
expect("user cannot publish to another user's account", () => canPublishToAccount(viewer("USER"), "another-user"), false);
expect("user cannot publish to a legacy account", () => canPublishToAccount(viewer("USER"), null), false);
expect("staff can publish to a legacy account", () => canPublishToAccount(viewer("ADMIN"), null), true);
expect("staff-authored jobs cannot use another user's account", () => canPublishToAccount(viewer("SUPER_ADMIN"), "another-user"), false);
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
