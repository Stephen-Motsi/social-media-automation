import Link from "next/link";
import { prisma } from "@/lib/db";
import { isStaff, pageViewer } from "@/lib/session";
import { loadUserDraft } from "@/lib/user-drafts";
import { UserHeader } from "../header";
import { UserStudio } from "./studio";

export const dynamic = "force-dynamic";

export default async function UserCreatePage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const viewer = await pageViewer("user");
  const { id } = await searchParams;
  let draft: Awaited<ReturnType<typeof loadUserDraft>> = null;
  let draftError = false;
  if (id) {
    try {
      draft = await loadUserDraft(viewer.id, id);
      draftError = !draft;
    } catch (error) {
      console.error("Could not load user draft:", error);
      draftError = true;
    }
  }
  const assets = draftError ? [] : await prisma.mediaAsset.findMany({
    where: { createdById: viewer.id, blocked: false },
    select: { id: true, width: true, height: true, blocked: true },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="min-h-screen pb-16">
      <UserHeader email={viewer.email} current="/me/create" staff={isStaff(viewer.role)} />
      <main className="rise mx-auto max-w-5xl space-y-6 px-4 pt-10">
        <h1 className="text-3xl font-semibold">{draft ? "Edit draft" : "Create an advert"}</h1>
        <p className="text-ink-soft">Prepare a draft with your own images. Publishing and scheduling are not available in this workspace yet.</p>
        {draftError ? (
          <p role="alert" className="glass rounded-2xl p-4">
            This draft was not found or cannot be safely edited here. <Link href="/me/adverts" className="underline">Return to drafts</Link>.
          </p>
        ) : (
          <UserStudio draft={draft} assets={assets.map((asset) => ({ ...asset, url: `/api/media/${asset.id}` }))} />
        )}
      </main>
    </div>
  );
}
