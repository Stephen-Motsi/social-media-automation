import { prisma } from "@/lib/db";
import { pageViewer } from "@/lib/session";
import { RequestsPanel } from "./panel";

export const dynamic = "force-dynamic";

export default async function WhatsappRequestsPage() {
  await pageViewer("staff");
  const requests = await prisma.whatsappConnectionRequest.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, status: true, qrExpiresAt: true, error: true, user: { select: { name: true, email: true, whatsappSession: { select: { status: true } } } } },
  });
  return (
    <div className="space-y-5">
      <p className="text-ink-soft">Start or refresh a requested session. The QR code is shown only in the requesting user&apos;s account.</p>
      <RequestsPanel requests={requests.map((r) => ({ ...r, qrExpiresAt: r.qrExpiresAt?.toISOString() ?? null }))} />
    </div>
  );
}
