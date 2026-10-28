import type { ReactNode } from "react";
import { PublicNavbar } from "./public-navbar";
import { getViewer, isStaff } from "@/lib/session";

export async function PublicPageShell({ children }: { children: ReactNode }) {
  const viewer = await getViewer();
  const dashboard = viewer ? (isStaff(viewer.role) ? "/admin" : "/me") : null;
  const brand = process.env.BRAND_NAME ?? "Social Automation";
  return (
    <div className="public-site">
      <PublicNavbar brand={brand} dashboard={dashboard} />
      <main className="public-page-main">{children}</main>
    </div>
  );
}
