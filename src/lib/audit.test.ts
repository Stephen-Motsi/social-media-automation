import { createAdminAuditRunner, type AdminAuditRecord } from "@/lib/audit-core";

type TestTransaction = Record<string, never>;

const superAdmin = {
  id: "trusted-super-admin-id",
  email: "admin@example.test",
  name: "Admin",
  image: null,
  role: "SUPER_ADMIN" as const,
  sessionId: "trusted-session-id",
};

function expect(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) throw new Error(`${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
  console.log(`PASS  ${name}`);
}

async function expectRejects(name: string, operation: () => Promise<unknown>, error: Error) {
  try {
    await operation();
  } catch (actual) {
    expect(name, actual instanceof Error ? { name: actual.name, message: actual.message } : actual, {
      name: error.name,
      message: error.message,
    });
    return;
  }
  throw new Error(`${name}: expected rejection`);
}

async function main() {
  const records: AdminAuditRecord[] = [];
  let transactionCount = 0;
  const run = createAdminAuditRunner<TestTransaction>({
    getActor: async () => superAdmin,
    getIp: async () => "192.0.2.10",
    transaction: async (operation) => {
      transactionCount++;
      return operation({});
    },
    createAudit: async (_tx, record) => {
      records.push(record);
    },
  });

  const changed = await run("ROLE_CHANGE", async (_tx, actor) => ({
    result: "updated",
    event: {
      action: "ROLE_CHANGE",
      targetUserId: "target-user-id",
      detail: { from: "USER", to: "ADMIN" },
    },
  }));
  expect("successful admin mutation returns its result", changed, "updated");
  expect("actor comes from trusted server context and target/action are recorded", records[0], {
    action: "ROLE_CHANGE",
    targetUserId: "target-user-id",
    detail: { from: "USER", to: "ADMIN" },
    actorId: "trusted-super-admin-id",
    ip: "192.0.2.10",
  });

  let deniedTransactions = 0;
  const denied = createAdminAuditRunner<TestTransaction>({
    getActor: async () => {
      throw new Error("Only the super admin can do this.");
    },
    getIp: async () => null,
    transaction: async (operation) => {
      deniedTransactions++;
      return operation({});
    },
    createAudit: async (_tx, record) => {
      records.push(record);
    },
  });
  await expectRejects(
    "unauthorized actor cannot reach mutation or forge an audit event",
    () => denied("ROLE_CHANGE", async () => ({ result: "forged", event: { action: "ROLE_CHANGE", targetUserId: "victim", detail: { from: "USER", to: "ADMIN" } } })),
    new Error("Only the super admin can do this."),
  );
  expect("denial occurs before opening a transaction", deniedTransactions, 0);
  expect("denial creates no audit event", records.length, 1);

  await expectRejects(
    "failed mutation is not recorded as successful",
    () => run("SESSION_REVOKED", async () => {
      throw new Error("mutation failed");
    }),
    new Error("mutation failed"),
  );
  expect("failed mutation creates no audit event", records.length, 1);

  await expectRejects(
    "sensitive metadata and client actor fields are rejected",
    () =>
      run("ROLE_CHANGE", async () => ({
        result: "updated",
        event: {
          action: "ROLE_CHANGE",
          targetUserId: "target-user-id",
          detail: { from: "USER", to: "ADMIN", actorId: "client-supplied" },
        },
      })),
    new Error("Unable to record administrative audit event."),
  );
  expect("invalid metadata creates no audit event", records.length, 1);

  const revoke = await run("SESSIONS_REVOKED", async () => ({
    result: 2,
    event: { action: "SESSIONS_REVOKED", targetUserId: "target-user-id", detail: { count: 2 } },
  }));
  expect("session revocations are recorded with their count", [revoke, records[1]], [
    2,
    {
      action: "SESSIONS_REVOKED",
      targetUserId: "target-user-id",
      detail: { count: 2 },
      actorId: "trusted-super-admin-id",
      ip: "192.0.2.10",
    },
  ]);
  expect("audit writes occur inside the transaction", transactionCount, 4);

  let auditFailureTransactionCount = 0;
  const auditFailure = createAdminAuditRunner<TestTransaction>({
    getActor: async () => superAdmin,
    getIp: async () => null,
    transaction: async (operation) => {
      auditFailureTransactionCount++;
      return operation({});
    },
    createAudit: async () => {
      throw new Error("database write failed");
    },
  });
  await expectRejects(
    "audit write failure propagates instead of reporting success",
    () =>
      auditFailure("SESSION_REVOKED", async () => ({
        result: "revoked",
        event: { action: "SESSION_REVOKED", targetUserId: "target-user-id", detail: null },
      })),
    new Error("database write failed"),
  );
  expect("audit persistence uses the transaction boundary", auditFailureTransactionCount, 1);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
