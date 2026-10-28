import type { Viewer } from "@/lib/session";

export type AdminAuditAction = "ROLE_CHANGE" | "SESSION_REVOKED" | "SESSIONS_REVOKED";

type AdminAuditRequest = {
  action: AdminAuditAction;
  targetUserId: string;
  detail: unknown;
};

export type AdminAuditRecord = AdminAuditRequest & { actorId: string; ip: string | null };

function validateAdminAuditRequest(request: AdminAuditRequest): AdminAuditRequest {
  if (typeof request.targetUserId !== "string" || request.targetUserId.trim() === "") {
    throw new Error("Unable to record administrative audit event.");
  }

  const detail = request.detail;
  if (request.action === "SESSION_REVOKED") {
    if (detail !== null) throw new Error("Unable to record administrative audit event.");
    return request;
  }

  if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
    throw new Error("Unable to record administrative audit event.");
  }
  const fields = detail as Record<string, unknown>;
  const keys = Object.keys(fields).sort();

  if (request.action === "ROLE_CHANGE") {
    if (
      keys.length !== 2 ||
      keys[0] !== "from" ||
      keys[1] !== "to" ||
      typeof fields.from !== "string" ||
      !["USER", "ADMIN", "SUPER_ADMIN"].includes(fields.from) ||
      (fields.to !== "USER" && fields.to !== "ADMIN")
    ) {
      throw new Error("Unable to record administrative audit event.");
    }
    return request;
  }

  if (
    keys.length !== 1 ||
    keys[0] !== "count" ||
    typeof fields.count !== "number" ||
    !Number.isSafeInteger(fields.count) ||
    fields.count < 0
  ) {
    throw new Error("Unable to record administrative audit event.");
  }
  return request;
}

export type AdminAuditOutcome<T> = {
  result: T;
  event: AdminAuditRequest | null;
};

export function createAdminAuditRunner<Tx>(dependencies: {
  getActor: () => Promise<Viewer>;
  getIp: () => Promise<string | null>;
  transaction: <T>(operation: (tx: Tx) => Promise<T>) => Promise<T>;
  createAudit: (tx: Tx, record: AdminAuditRecord) => Promise<void>;
}) {
  return async function withAdminAudit<T>(
    action: AdminAuditAction,
    operation: (tx: Tx, actor: Viewer) => Promise<AdminAuditOutcome<T>>,
  ): Promise<T> {
    const actor = await dependencies.getActor();
    const ip = await dependencies.getIp();

    return dependencies.transaction(async (tx) => {
      const outcome = await operation(tx, actor);
      if (outcome.event) {
        if (outcome.event.action !== action) throw new Error("Unable to record administrative audit event.");
        const request = validateAdminAuditRequest(outcome.event);
        await dependencies.createAudit(tx, { ...request, actorId: actor.id, ip });
      }
      return outcome.result;
    });
  };
}
