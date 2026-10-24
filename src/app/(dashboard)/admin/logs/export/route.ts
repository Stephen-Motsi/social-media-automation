import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getViewer, isStaff } from "@/lib/session";
import { activityDetail, activityLabel } from "@/lib/activity";
import { activityWhere } from "../query";

const MAX_ROWS = 10_000;
// Spreadsheet-safe: quote every cell, and stop formulas (=, +, -, @) from running when opened.
const cell = (v: unknown) => `"${String(v ?? "").replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"`;

// The activity log as CSV, with the Logs page's filters. Staff only.
export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer || !isStaff(viewer.role)) return NextResponse.json({ error: "Only admins can export logs." }, { status: 403 });
  const p = new URL(req.url).searchParams;
  const rows = await prisma.activityLog.findMany({
    where: activityWhere({ q: p.get("q") ?? undefined, action: p.get("action") ?? undefined, from: p.get("from") ?? undefined, to: p.get("to") ?? undefined }),
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
    include: { user: { select: { email: true, name: true, role: true } } },
  });
  const lines = [
    ["Time (UTC)", "User", "Email", "Role", "Event", "Details", "IP"].map(cell).join(","),
    ...rows.map((r) => [r.createdAt.toISOString(), r.user.name, r.user.email, r.user.role, activityLabel(r.action), activityDetail(r.detail), r.ip].map(cell).join(",")),
  ];
  return new NextResponse(lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="activity-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
