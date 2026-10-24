"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/session";

export async function markAllRead() {
  await requireStaff();
  await prisma.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}

export async function markRead(id: string) {
  await requireStaff();
  await prisma.notification.updateMany({ where: { id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}
