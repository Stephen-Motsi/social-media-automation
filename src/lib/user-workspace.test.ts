import assert from "node:assert/strict";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { GetPrismaClientConfig } from "@prisma/client/runtime/library";

const prismaOptions = {
  datasourceUrl: "postgresql://test:test@127.0.0.1:65432/test",
  __internal: {
    configOverride: (config: GetPrismaClientConfig) => ({
      ...config, relativeEnvPaths: undefined, injectableEdgeEnv: undefined,
    }),
  },
};
const typedOptions: Prisma.PrismaClientOptions = prismaOptions;
const prisma = new PrismaClient(typedOptions);
(globalThis as typeof globalThis & { prisma?: PrismaClient }).prisma = prisma;

type Asset = {
  id: string; createdById: string; blocked: boolean; data: Uint8Array; mimeType: string;
  width: number; height: number; sizeBytes: number; prompt: string | null; source: "GENERATED" | "UPLOADED";
};
type Draft = {
  id: string; authorId: string; status: string; channelId: string | null; sourceAdvertId: string | null;
  listedAt: Date | null; title: string | null; about: string | null; content: string;
  targetPlatforms: string[]; mediaUrls: string[]; platformMedia: Record<string, string> | null;
};

const image = Buffer.alloc(32);
image.writeUInt32BE(0x89504e47, 0);
image.writeUInt32BE(1024, 16);
image.writeUInt32BE(1024, 20);
const makeAsset = (id: string, createdById: string, blocked = false): Asset => ({
  id, createdById, blocked, data: image, mimeType: "image/png", width: 1024, height: 1024,
  sizeBytes: image.length, prompt: null, source: "UPLOADED",
});
const assets = [makeAsset("aliceimage", "alice"), makeAsset("bobimage", "bob"), makeAsset("blocked", "alice", true)];
const drafts: Draft[] = [
  { id: "alice-draft", authorId: "alice", status: "DRAFT", channelId: null, sourceAdvertId: null, listedAt: null, title: "Alice", about: null, content: "Original", targetPlatforms: ["FACEBOOK"], mediaUrls: ["http://localhost:3000/api/media/aliceimage"], platformMedia: { FACEBOOK: "http://localhost:3000/api/media/aliceimage" } },
  { id: "bob-draft", authorId: "bob", status: "DRAFT", channelId: null, sourceAdvertId: null, listedAt: null, title: "Bob", about: null, content: "Private", targetPlatforms: [], mediaUrls: [], platformMedia: null },
  { id: "listed-draft", authorId: "alice", status: "DRAFT", channelId: null, sourceAdvertId: null, listedAt: new Date(), title: "Listed", about: null, content: "Published", targetPlatforms: [], mediaUrls: [], platformMedia: null },
];
let nextAsset = 0;
let nextDraft = 0;
let limitReached = false;
let moderationBlocked = false;
let moderationUnavailable = false;
let failImageRequest = false;
let failImageModeration = false;
let rejectUpdate = false;
let requests = 0;

Object.defineProperty(prisma, "mediaAsset", { value: {
  findMany: async ({ where }: { where: { id?: { in: string[] }; createdById?: string; blocked?: boolean } }) =>
    assets.filter((asset) => (!where.id || where.id.in.includes(asset.id))
      && (where.createdById === undefined || asset.createdById === where.createdById)
      && (where.blocked === undefined || asset.blocked === where.blocked)),
  findFirst: async ({ where }: { where: { id: string; createdById?: string } }) =>
    assets.find((asset) => asset.id === where.id && (where.createdById === undefined || asset.createdById === where.createdById)) ?? null,
  count: async () => limitReached ? 20 : 0,
  create: async ({ data }: { data: Omit<Asset, "id"> }) => {
    const asset = { ...data, id: `generated${++nextAsset}` };
    assets.push(asset);
    return asset;
  },
} });
Object.defineProperty(prisma, "post", { value: {
  findFirst: async ({ where }: { where: { id: string; authorId: string } }) =>
    drafts.find((draft) => draft.id === where.id && draft.authorId === where.authorId && draft.status === "DRAFT"
      && draft.channelId === null && draft.sourceAdvertId === null && draft.listedAt === null) ?? null,
  updateMany: async ({ where, data }: { where: { id: string; authorId: string }; data: Partial<Draft> }) => {
    if (rejectUpdate) return { count: 0 };
    const draft = drafts.find((item) => item.id === where.id && item.authorId === where.authorId
      && item.status === "DRAFT" && item.channelId === null && item.sourceAdvertId === null && item.listedAt === null);
    if (!draft) return { count: 0 };
    Object.assign(draft, data);
    return { count: 1 };
  },
  create: async ({ data }: { data: Draft }) => {
    const draft = { ...data, id: `new-draft-${++nextDraft}`, channelId: null, sourceAdvertId: null, listedAt: null };
    drafts.push(draft);
    return { id: draft.id };
  },
  count: async ({ where }: { where: { authorId: string; status: string } }) => {
    assert.equal(where.authorId, "alice");
    return { DRAFT: 2, SCHEDULED: 3, PUBLISHED: 4, FAILED: 5 }[where.status] ?? 0;
  },
  findMany: async ({ where, select }: { where: { authorId: string }; select: { targets?: { where: { account: { ownerId: string } } } } }) => {
    assert.equal(where.authorId, "alice");
    if (select.targets) assert.equal(select.targets.where.account.ownerId, "alice");
    return [];
  },
} });
Object.defineProperty(prisma, "user", { value: {
  findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
    assert.equal(where.id, "alice");
    return { name: "Alice", accounts: [], sessions: [], activity: [] };
  },
} });
Object.defineProperty(prisma, "socialAccount", { value: {
  findMany: async ({ where }: { where: { ownerId: string } }) => { assert.equal(where.ownerId, "alice"); return []; },
} });
Object.defineProperty(prisma, "whatsappConnectionRequest", { value: {
  findUnique: async ({ where }: { where: { userId: string } }) => { assert.equal(where.userId, "alice"); return null; },
} });

process.env.OPENAI_API_KEY = "dummy";
process.env.OPENAI_BASE_URL = "http://mock.invalid/v1";
process.env.PUBLIC_BASE_URL = "http://localhost:3000";
globalThis.fetch = async (input) => {
  requests++;
  const url = new URL(String(input));
  assert.equal(url.hostname, "mock.invalid");
  if (url.pathname === "/v1/moderations") {
    if (moderationUnavailable) return Response.json({ error: { message: "mock unavailable" } }, { status: 503 });
    return Response.json({ results: [{ flagged: moderationBlocked, categories: { sexual: moderationBlocked }, category_scores: {} }] });
  }
  assert.ok(url.pathname === "/v1/images/generations" || url.pathname === "/v1/images/edits");
  if (failImageRequest) return Response.json({ error: { message: "mock image failure" } }, { status: 503 });
  if (failImageModeration) moderationUnavailable = true;
  return Response.json({ data: [{ b64_json: image.toString("base64") }] });
};

async function main() {
  const { generateAdvertImage, refineAdvertImage, uploadAdvertImage } = await import("@/lib/advert-images");
  const { loadUserDraft, saveUserDraft } = await import("@/lib/user-drafts");
  const { userDashboard } = await import("@/lib/user-dashboard");
  const dashboard = await userDashboard("alice");
  assert.deepEqual(dashboard.counts, { drafts: 2, scheduled: 3, published: 4, failed: 5 });

  const before = requests;
  const denied = await refineAdvertImage("alice", "bobimage", "Make brighter", "FACEBOOK", "POST", "", { ownerOnly: true });
  assert.equal(denied.ok, false);
  assert.equal(requests, before);
  assert.equal((await refineAdvertImage("alice", "blocked", "Make brighter", "FACEBOOK", "POST", "", { ownerOnly: true })).ok, false);
  const refined = await refineAdvertImage("alice", "aliceimage", "Make brighter", "FACEBOOK", "POST", "", { ownerOnly: true });
  assert.equal(refined.ok, true);
  if (refined.ok) assert.equal(assets.find((asset) => asset.id === refined.media.id)?.createdById, "alice");
  const staffRefined = await refineAdvertImage("staff", "bobimage", "Make brighter", "FACEBOOK", "POST");
  assert.equal(staffRefined.ok, true);
  if (staffRefined.ok) assert.equal(assets.find((asset) => asset.id === staffRefined.media.id)?.createdById, "staff");

  const generated = await generateAdvertImage("alice", "A product on a table", "FACEBOOK", "POST", "Hello");
  assert.equal(generated.ok, true);
  if (generated.ok) assert.equal(assets.find((asset) => asset.id === generated.media.id)?.createdById, "alice");
  const uploaded = await uploadAdvertImage("alice", image, "FACEBOOK", "POST", "Hello");
  assert.equal(uploaded.ok, true);
  if (uploaded.ok) assert.equal(assets.find((asset) => asset.id === uploaded.media.id)?.createdById, "alice");

  limitReached = true;
  const atLimit = requests;
  assert.equal((await generateAdvertImage("alice", "A product on a table", "FACEBOOK", "POST")).ok, false);
  assert.equal(requests, atLimit);
  limitReached = false;
  moderationBlocked = true;
  const blocked = await uploadAdvertImage("alice", image, "FACEBOOK", "POST", "Hello");
  assert.ok(blocked.ok && blocked.media.blocked);
  const beforeBlockedGeneration = requests;
  assert.equal((await generateAdvertImage("alice", "A product on a table", "FACEBOOK", "POST")).ok, false);
  assert.equal(requests, beforeBlockedGeneration + 1);
  moderationBlocked = false;
  moderationUnavailable = true;
  const unavailable = await generateAdvertImage("alice", "A product on a table", "FACEBOOK", "POST");
  assert.equal(unavailable.ok, false);
  moderationUnavailable = false;
  failImageRequest = true;
  assert.equal((await generateAdvertImage("alice", "A product on a table", "FACEBOOK", "POST")).ok, false);
  assert.equal((await refineAdvertImage("alice", "aliceimage", "Make brighter", "FACEBOOK", "POST", "", { ownerOnly: true })).ok, false);
  failImageRequest = false;
  failImageModeration = true;
  const unchecked = await generateAdvertImage("alice", "A product on a table", "FACEBOOK", "POST");
  assert.ok(unchecked.ok && unchecked.media.blocked && unchecked.verdict.status === "block");
  moderationUnavailable = false;
  failImageModeration = false;

  const base = { title: "Draft", about: "", caption: "Hello", platforms: ["FACEBOOK" as const] };
  await assert.rejects(() => saveUserDraft("alice", { ...base, media: [{ platform: "FACEBOOK", id: "bobimage" }] }), /does not belong/);
  await assert.rejects(() => saveUserDraft("alice", { ...base, media: [{ platform: "FACEBOOK", id: "blocked" }] }), /unavailable/);
  await assert.rejects(() => saveUserDraft("alice", { ...base, id: "bob-draft", media: [] }), /not found/);
  await assert.rejects(() => saveUserDraft("alice", { ...base, id: "listed-draft", media: [] }), /not found/);
  assert.equal(drafts[1].content, "Private");
  assert.equal(drafts[2].content, "Published");
  assert.equal(await loadUserDraft("alice", "bob-draft"), null);
  assert.equal((await loadUserDraft("alice", "alice-draft"))?.media[0].id, "aliceimage");

  const saved = await saveUserDraft("alice", { ...base, media: [{ platform: "FACEBOOK", id: "aliceimage" }] });
  const created = drafts.find((draft) => draft.id === saved.postId);
  assert.equal(created?.authorId, "alice");
  assert.deepEqual(created?.platformMedia, { FACEBOOK: "http://localhost:3000/api/media/aliceimage" });
  assert.equal((await loadUserDraft("alice", saved.postId))?.media[0].id, "aliceimage");
  const fallback = await saveUserDraft("alice", {
    ...base, platforms: ["FACEBOOK", "INSTAGRAM"], media: [{ platform: "FACEBOOK", id: "aliceimage" }],
  });
  assert.ok(fallback.verdicts.find((verdict) => verdict.platform === "INSTAGRAM")?.issues.some((issue) => issue.code === "image.format"));
  assert.deepEqual((await loadUserDraft("alice", fallback.postId))?.media.map((item) => item.id), ["aliceimage", "aliceimage"]);
  moderationUnavailable = true;
  const failedChecks = await saveUserDraft("alice", { ...base, media: [] });
  assert.equal(failedChecks.verdicts[0].status, "block");
  assert.ok(failedChecks.verdicts[0].issues.some((issue) => issue.code === "moderation.unavailable"));
  moderationUnavailable = false;
  rejectUpdate = true;
  await assert.rejects(() => saveUserDraft("alice", { ...base, id: saved.postId, caption: "Race", media: [] }), /no longer editable/);
  assert.equal(created?.content, "Hello");
  rejectUpdate = false;
  await saveUserDraft("alice", { ...base, id: saved.postId, caption: "Edited", media: [] });
  assert.equal(created?.content, "Edited");
  assert.deepEqual(created?.mediaUrls, []);

  drafts[0].platformMedia = { FACEBOOK: "http://localhost:3000/api/media/bobimage" };
  await assert.rejects(() => loadUserDraft("alice", "alice-draft"), /does not belong/);
  console.log("PASS owner-scoped dashboard, draft selection, generation, refinement, uploads and moderation");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
