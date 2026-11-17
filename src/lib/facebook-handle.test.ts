// End-to-end check: type a Facebook handle -> connect by handle -> publish a post, against a mock
// Graph API (no real Facebook calls). Needs the dev database. Run with `npm test`.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

let fails = 0;
function expect(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
}

const PAGE_ID = "9000000000001";
const PAGE_TOKEN = "mock-page-token";
const calls: { method: string; path: string; auth: string; body: Record<string, unknown> }[] = [];

async function main() {
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const url = new URL(req.url!, "http://x");
  calls.push({ method: req.method!, path: url.pathname, auth: String(req.headers.authorization ?? ""), body: raw ? JSON.parse(raw) : {} });
  res.setHeader("content-type", "application/json");
  if (url.pathname.endsWith("/me/accounts")) {
    return res.end(JSON.stringify({ data: [{ id: PAGE_ID, name: "Mock Market", username: "MockMarketKE", access_token: PAGE_TOKEN }] }));
  }
  if (url.pathname.endsWith(`/${PAGE_ID}/feed`)) return res.end(JSON.stringify({ id: `${PAGE_ID}_111` }));
  res.statusCode = 404;
  res.end(JSON.stringify({ error: { message: "not found", code: 100 } }));
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.META_GRAPH_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.META_SYSTEM_USER_TOKEN = "mock-system-token";
process.env.TOKEN_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");

const { prisma } = await import("@/lib/db");
const { ensureAllContainers } = await import("@/lib/channels");
const { connectByHandle } = await import("@/lib/connect-by-handle");
const { publishPagePost } = await import("@/lib/meta/facebook");
const { accessTokenFor } = await import("@/lib/tokens");

await ensureAllContainers();
const channel = await prisma.channel.findUniqueOrThrow({ where: { platform: "FACEBOOK" } });
const hadAccount = await prisma.socialAccount.findUnique({ where: { platform_externalId: { platform: "FACEBOOK", externalId: PAGE_ID } } });

try {
  // Wrong handle: nothing is linked and the admin is told what the token can see.
  await prisma.channel.update({ where: { id: channel.id }, data: { handle: "someone-else" } });
  const bad = await connectByHandle("FACEBOOK");
  expect("unknown handle is rejected", bad.ok, false);
  expect("rejection lists available pages", !bad.ok && bad.error.includes("MockMarketKE"), true);

  // Right handle (as typed from a profile link): the Page is found and linked.
  await prisma.channel.update({ where: { id: channel.id }, data: { handle: "https://www.facebook.com/MockMarketKE/" } });
  const good = await connectByHandle("FACEBOOK");
  expect("matching handle connects", good.ok, true);
  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { platform_externalId: { platform: "FACEBOOK", externalId: PAGE_ID } } });
  expect("page token is stored encrypted", account.accessTokenEncrypted.includes(PAGE_TOKEN), false);

  // Publishing uses the stored Page token against that Page's feed.
  const token = await accessTokenFor(account);
  expect("stored token decrypts", token, PAGE_TOKEN);
  const posted = await publishPagePost({ pageId: account.externalId, pageAccessToken: token, message: "Hello from the automation" });
  expect("post returns the platform id", posted.id, `${PAGE_ID}_111`);
  const feed = calls.find((c) => c.path.endsWith(`/${PAGE_ID}/feed`));
  expect("post sent to the Page feed", feed?.method, "POST");
  expect("post used the Page token", feed?.auth.endsWith(PAGE_TOKEN), true);
  expect("post carried the message", feed?.body.message, "Hello from the automation");
} finally {
  await prisma.channel.update({ where: { id: channel.id }, data: { handle: channel.handle } });
  if (!hadAccount) await prisma.socialAccount.deleteMany({ where: { platform: "FACEBOOK", externalId: PAGE_ID } });
  await prisma.$disconnect();
  server.close();
}

if (fails) {
  console.log(`\n${fails} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
