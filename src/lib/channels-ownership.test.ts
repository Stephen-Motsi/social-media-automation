import assert from "node:assert/strict";
import { prisma } from "./db";
import { runChannel } from "./channels";

const author = { id: "alice", role: "USER" };
let groupOwner: string | null = "alice";
let channelOwner: string | null = "alice";
let advertAuthor = author;
let accountsWhere: unknown;

Object.defineProperty(prisma, "channel", {
  value: {
    findUniqueOrThrow: async () => ({
      id: "channel",
      ownerId: channelOwner,
      platform: "X",
      handle: "alice",
      group: { ownerId: groupOwner },
      advert: { authorId: advertAuthor.id, author: advertAuthor, reviewStatus: "APPROVED" },
    }),
  },
});
Object.defineProperty(prisma, "socialAccount", {
  value: {
    findMany: async ({ where }: { where: unknown }) => {
      accountsWhere = where;
      return [];
    },
  },
});

async function main() {
  await assert.rejects(runChannel("channel"), /No connected account/);
  assert.deepEqual(accountsWhere, { platform: "X", ownerId: "alice" });
  accountsWhere = undefined;
  groupOwner = "bob";
  await assert.rejects(runChannel("channel"), /different owners/);
  assert.equal(accountsWhere, undefined);
  groupOwner = "alice";
  advertAuthor = { id: "bob", role: "USER" };
  await assert.rejects(runChannel("channel"), /different owners/);
  channelOwner = null;
  groupOwner = null;
  advertAuthor = author;
  await assert.rejects(runChannel("channel"), /cannot use a shared channel/);
  console.log("PASS channel ownership isolation");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
