import { graphRequest } from "./graph";

// WhatsApp Cloud API messaging.
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages
// WhatsApp has no "feed": "publishing" means sending messages to recipients.
// Free-form messages only work within 24h of the user's last message; outside that window
// you must send a pre-approved template (sendTemplate).

type SendResult = { messages: { id: string }[] };

export async function sendText(opts: {
  phoneNumberId: string;
  accessToken: string;
  to: string; // international format, digits only, e.g. 254712345678
  body: string;
}): Promise<SendResult> {
  return graphRequest<SendResult>(`${opts.phoneNumberId}/messages`, opts.accessToken, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      to: opts.to,
      type: "text",
      text: { body: opts.body },
    },
  });
}

export async function sendTemplate(opts: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  templateName: string;
  languageCode?: string;
  components?: unknown[];
}): Promise<SendResult> {
  return graphRequest<SendResult>(`${opts.phoneNumberId}/messages`, opts.accessToken, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      to: opts.to,
      type: "template",
      template: {
        name: opts.templateName,
        language: { code: opts.languageCode ?? "en_US" },
        ...(opts.components ? { components: opts.components } : {}),
      },
    },
  });
}

// TODO: media messages (image/document), contact lists / broadcast audiences, status updates via webhook.
