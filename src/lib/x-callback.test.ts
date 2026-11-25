import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "./db";
import { boundOAuthState, type OAuthAccountScope } from "./oauth-state";
import type { Viewer } from "./session";

process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
process.env.AUTH_URL = "http://localhost:3000";
let viewer: Viewer = { id: "alice", sessionId: "session", role: "USER", email: "alice@example.test", name: null, image: null };
const sessionPath = require.resolve("./session");
require(sessionPath);
const sessionModule = require.cache[sessionPath]!;
sessionModule.exports = { ...sessionModule.exports, getViewer: async () => viewer };

let saves: { ownerId: string | null }[] = [];
Object.defineProperty(prisma, "channel", { value: { findFirst: async () => ({ handle: "alice" }) } });
Object.defineProperty(prisma, "socialAccount", {
  value: {
    updateMany: async ({ where }: { where: { ownerId: string | null } }) => {
      saves.push({ ownerId: where.ownerId });
      return { count: 1 };
    },
    findFirstOrThrow: async () => ({ id: "account" }),
  },
});
Object.defineProperty(prisma, "tokenRefreshAttempt", { value: { deleteMany: async () => ({ count: 0 }) } });
Object.defineProperty(prisma, "$transaction", { value: async (operation: (tx: unknown) => Promise<unknown>) =>
  operation({ socialAccount: prisma.socialAccount, tokenRefreshAttempt: prisma.tokenRefreshAttempt, $queryRaw: async () => [{ acquired: true }] }) });

async function main() {
  const { GET } = await import("../app/api/x/callback/route");
  let scope: unknown;
  globalThis.fetch = async (input) => String(input).includes("/oauth2/token")
    ? Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600, scope })
    : Response.json({ data: { id: "provider-id", name: "Alice", username: "alice" } });

  function request(accountScope: OAuthAccountScope) {
    const state = "random-state";
    const cookie = boundOAuthState(state, viewer, accountScope);
    return new NextRequest(`http://localhost:3000/api/x/callback?state=${state}&code=code`, {
      headers: { cookie: `x_oauth_state=${cookie}; x_oauth_verifier=verifier` },
    });
  }
  for (const bad of [undefined, "", "tweet.read tweet.write users.read"]) {
    scope = bad;
    saves = [];
    const response = await GET(request("personal"));
    assert.equal(new URL(response.headers.get("location")!).searchParams.get("error"), "provider_permissions_missing");
    assert.equal(saves.length, 0);
  }
  scope = "tweet.read tweet.write users.read media.write offline.access";
  for (const [role, accountScope, ownerId] of [
    ["USER", "personal", "alice"],
    ["ADMIN", "personal", "alice"],
    ["SUPER_ADMIN", "shared", null],
  ] as const) {
    viewer = { ...viewer, role };
    saves = [];
    const response = await GET(request(accountScope));
    assert.equal(new URL(response.headers.get("location")!).searchParams.get("connected"), "1");
    assert.deepEqual(saves, [{ ownerId }]);
  }
  console.log("PASS X callback rejects unconfirmed scopes and preserves personal/shared ownership");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
