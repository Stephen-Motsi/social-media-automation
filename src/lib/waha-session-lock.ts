import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type LockContext = { sessionName: string; uncertain: boolean; active: boolean; parent?: LockContext };
const heldLocks = new AsyncLocalStorage<LockContext>();

export function markWahaOperationUncertain() {
  const context = heldLocks.getStore();
  if (context?.active) context.uncertain = true;
}

export function confirmWahaOperationStopped() {
  const context = heldLocks.getStore();
  if (context?.active) context.uncertain = false;
}

export async function withWahaSessionLock<T>(sessionName: string, operation: () => Promise<T>): Promise<T> {
  const held = heldLocks.getStore();
  for (let context = held; context; context = context.parent) {
    if (context.active && context.sessionName === sessionName) return operation();
  }
  const token = randomUUID();
  try {
    await prisma.wahaOperationLock.create({ data: { sessionName, token } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("Another WhatsApp operation is in progress or requires reconciliation.");
    }
    throw error;
  }
  const context: LockContext = { sessionName, uncertain: false, active: true, parent: held };
  try {
    const result = await heldLocks.run(context, operation);
    if (context.uncertain) throw new Error("WhatsApp operation outcome is unknown; its lock requires reconciliation.");
    return result;
  } finally {
    context.active = false;
    if (context.uncertain) {
      console.error("[WAHA] Operation outcome is unknown; retaining its session lock for reconciliation.");
    } else {
      const released = await prisma.wahaOperationLock.deleteMany({ where: { sessionName, token } });
      if (!released.count) throw new Error("WhatsApp operation lock was lost; reconciliation is required.");
    }
  }
}
