import { isStaff, pageViewer } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Studio } from "./studio";
import { platformOrder } from "@/lib/policy/rules";
import { displayHandle } from "@/lib/handles";
import { platforms } from "@/components/platforms";

export const dynamic = "force-dynamic";

export default async function CreatePage() {
  await pageViewer("staff");
  const [interests, channels] = await Promise.all([
    prisma.interest.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.channel.findMany({ where: { handle: { not: null } } }),
  ]);
  const channelPlatforms = platformOrder
    .filter((p) => channels.some((c) => c.platform === p))
    .map((p) => ({ platform: p, handle: `${platforms[p].name} · ${displayHandle(p, channels.find((c) => c.platform === p)!.handle)}` }));
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Create an advert</h1>
      <p className="mt-2 max-w-prose text-ink-soft">
        Describe an image, add a caption, and see right away whether it can go on Facebook, Instagram and WhatsApp.
      </p>
      <Studio interests={interests} channelPlatforms={channelPlatforms} />
    </div>
  );
}
