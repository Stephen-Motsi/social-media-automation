import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifySignature } from "@/lib/meta/webhook";

// One endpoint for Facebook Page, Instagram and WhatsApp webhooks.
// Configure in the Meta app dashboard: Callback URL = <APP_URL>/api/webhooks/meta

// Subscription verification handshake
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  if (
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === process.env.META_WEBHOOK_VERIFY_TOKEN
  ) {
    return new NextResponse(params.get("hub.challenge"), { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

// Event delivery
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!verifySignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  await prisma.webhookEvent.create({
    data: { object: String(payload.object ?? "unknown"), payload },
  });

  // TODO: process events (WhatsApp message statuses / inbound messages, comments, mentions).
  // Respond fast; Meta retries on non-200 responses.
  return NextResponse.json({ received: true });
}
