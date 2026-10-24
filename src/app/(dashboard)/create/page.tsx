import Link from "next/link";
import { pageViewer } from "@/lib/session";
import { prisma } from "@/lib/db";
import { platformOrder } from "@/lib/policy/rules";
import { displayHandle, handleMatches } from "@/lib/handles";
import { ensureAllContainers } from "@/lib/channels";
import { platformMediaOf } from "@/lib/advert-media";
import { platforms } from "@/components/platforms";
import { Studio, type ChannelOption, type DraftInput } from "./studio";

export const dynamic = "force-dynamic";

// Create a new advert, or edit a saved draft with ?id=
export default async function CreatePage({ searchParams }: { searchParams: Promise<{ id?: string; schedule?: string }> }) {
  await pageViewer("staff");
  const { id, schedule } = await searchParams;
  await ensureAllContainers();
  const [interests, channelRows, accounts, advert] = await Promise.all([
    prisma.interest.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.channel.findMany(),
    prisma.socialAccount.findMany(),
    id ? prisma.post.findFirst({ where: { id, status: "DRAFT", channelId: null }, include: { interests: true } }) : null,
  ]);
  // Every platform is offered; each says whether its account is connected yet.
  const channels: ChannelOption[] = platformOrder.flatMap((p) => {
    const c = channelRows.find((ch) => ch.platform === p);
    if (!c) return [];
    const handle = displayHandle(p, c.handle);
    const connected = !!c.handle && accounts.some((a) => a.platform === p && handleMatches(p, c.handle, a));
    return [{ platform: p, handle, label: handle ? `${platforms[p].name} · ${handle}` : platforms[p].name, format: c.format, connected }];
  });

  let draft: DraftInput | undefined;
  if (advert) {
    // Each platform's own image; older adverts have one image, used for each of their platforms
    const own = platformMediaOf(advert.platformMedia);
    const urls = Object.fromEntries(advert.targetPlatforms.flatMap((p) => (own[p] ?? advert.mediaUrls[0] ? [[p, own[p] ?? advert.mediaUrls[0]]] : [])));
    const idOf = (url: string) => url.match(/\/api\/media\/([a-z0-9]+)$/i)?.[1];
    const assets = await prisma.mediaAsset.findMany({
      where: { id: { in: Object.values(urls).map(idOf).filter((x): x is string => !!x) } },
      select: { id: true, width: true, height: true, blocked: true },
    });
    const photos = Object.fromEntries(
      Object.entries(urls).flatMap(([p, url]) => {
        const a = assets.find((x) => x.id === idOf(url));
        return a ? [[p, { id: a.id, url: `/api/media/${a.id}`, width: a.width, height: a.height, blocked: a.blocked }]] : [];
      }),
    );
    draft = {
      id: advert.id,
      title: advert.title ?? "",
      about: advert.about ?? "",
      caption: advert.content,
      topics: advert.interests.map((i) => i.id),
      towns: advert.targetLocations.join(", "),
      targetPlatforms: advert.targetPlatforms,
      photos,
      listed: !!advert.listedAt,
    };
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{draft ? (draft.listed ? "Edit advert" : "Edit draft") : "Create an advert"}</h1>
        <Link href="/admin/adverts" className="text-sm text-ink-soft hover:text-ink">
          All adverts
        </Link>
      </div>
      <p className="mt-2 max-w-prose text-ink-soft">
        Describe the advert and choose its platforms. Each platform gets its own photo made from the details, in the
        shape and style that platform shows best. Preview it on each platform before publishing.
        Save it as a draft any time.
      </p>
      {id && !advert && <p className="mt-4 text-danger">That draft wasn&rsquo;t found. You can start a new advert below.</p>}
      <Studio key={draft?.id ?? "new"} interests={interests} channels={channels} draft={draft} scheduleFirst={schedule === "1"} />
    </div>
  );
}
