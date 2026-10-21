"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { GraphApiError } from "@/lib/meta/graph";
import { getWhatsAppNumber } from "@/lib/meta/oauth";

export type FormState = { ok?: boolean; error?: string; message?: string } | undefined;

async function isAdmin() {
  const session = await auth();
  return session?.user?.role === "ADMIN";
}

const whatsappSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{5,20}$/, "The phone number ID is the long number shown under API Setup, not the phone number."),
  accessToken: z.string().trim().min(20, "Paste the full access token."),
});

async function saveWhatsApp(phoneNumberId: string, accessToken: string): Promise<FormState> {
  try {
    // Confirms the ID and token work together before saving anything.
    const number = await getWhatsAppNumber(phoneNumberId, accessToken);
    const displayName = `${number.verified_name} (${number.display_phone_number})`;
    const token = encrypt(accessToken);
    await prisma.socialAccount.upsert({
      where: { platform_externalId: { platform: "WHATSAPP", externalId: number.id } },
      update: { displayName, accessTokenEncrypted: token },
      create: { platform: "WHATSAPP", externalId: number.id, displayName, accessTokenEncrypted: token },
    });
    revalidatePath("/accounts");
    return { ok: true, message: `Connected ${displayName}.` };
  } catch (err) {
    if (err instanceof GraphApiError) {
      return { error: `Meta didn't accept these details: ${err.message}` };
    }
    throw err;
  }
}

export async function connectWhatsApp(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await isAdmin())) return { error: "Only admins can connect accounts." };
  const parsed = whatsappSchema.safeParse({
    phoneNumberId: formData.get("phoneNumberId"),
    accessToken: formData.get("accessToken"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  return saveWhatsApp(parsed.data.phoneNumberId, parsed.data.accessToken);
}

// Uses WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN from .env, so the token never touches the browser.
export async function connectWhatsAppFromEnv(): Promise<FormState> {
  if (!(await isAdmin())) return { error: "Only admins can connect accounts." };
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!id || !token) return { error: "WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN aren't set in .env." };
  return saveWhatsApp(id, token);
}

export async function disconnectAccount(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = String(formData.get("id") ?? "");
  // Removes the stored token. Pending targets for this account are removed with it.
  await prisma.socialAccount.delete({ where: { id } }).catch(() => null);
  revalidatePath("/accounts");
  revalidatePath("/");
}
