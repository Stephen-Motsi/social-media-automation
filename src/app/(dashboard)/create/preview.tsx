"use client";

import type { Platform, PostFormat } from "@prisma/client";
import { PlatformBadge, platforms } from "@/components/platforms";
import type { PlatformVerdict } from "@/lib/policy/rules";

// How the advert will look to users, on the site and on each platform it targets.

export type PreviewTarget = { platform: Platform; handle: string; format: PostFormat };

const statusCopy: Record<PlatformVerdict["status"], { label: string; className: string }> = {
  pass: { label: "Ready to post", className: "bg-wa/15 text-emerald-700 dark:text-emerald-300" },
  warn: { label: "Check before posting", className: "bg-amber-400/20 text-amber-800 dark:text-amber-200" },
  block: { label: "Can't post", className: "bg-danger/15 text-danger" },
};

function Img({ src, className = "" }: { src: string | null; className?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className={`w-full object-cover ${className}`} />
  ) : (
    <div className={`flex w-full items-center justify-center bg-ink/5 text-xs text-ink-soft ${className}`}>No photo</div>
  );
}

function Frame({ target, verdict, children }: { target: PreviewTarget; verdict?: PlatformVerdict; children: React.ReactNode }) {
  return (
    <figure className="space-y-2">
      <figcaption className="flex flex-wrap items-center gap-2 text-sm">
        <PlatformBadge platform={target.platform} />
        <span className="font-medium">
          {platforms[target.platform].name}
          {target.format === "STORY" ? " story" : ""}
        </span>
        {verdict && <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${statusCopy[verdict.status].className}`}>{statusCopy[verdict.status].label}</span>}
      </figcaption>
      {/* Platform previews use fixed light "app" colours, as the real apps do. */}
      <div className="overflow-hidden rounded-2xl border border-line bg-white text-[13px] text-neutral-900 shadow-sm">{children}</div>
      {verdict && verdict.issues.length > 0 && (
        <ul className="space-y-0.5 text-xs text-ink-soft">
          {verdict.issues.map((i) => (
            <li key={i.code} className="flex gap-1.5">
              <span aria-hidden className={`mt-1.5 size-1.5 shrink-0 rounded-full ${i.severity === "block" ? "bg-danger" : "bg-amber-500"}`} />
              {i.message}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

const Avatar = ({ platform }: { platform: Platform }) => <PlatformBadge platform={platform} />;

function PostPreview({ target, caption, image, verdict }: { target: PreviewTarget; caption: string; image: string | null; verdict?: PlatformVerdict }) {
  const { platform, handle, format } = target;

  if (format === "STORY") {
    return (
      <Frame target={target} verdict={verdict}>
        <div className="relative mx-auto aspect-[9/16] max-h-96 bg-black">
          <Img src={image} className="h-full" />
          <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/50 p-3 text-xs text-white">
            <Avatar platform={platform} /> {handle}
          </div>
        </div>
      </Frame>
    );
  }

  switch (platform) {
    case "FACEBOOK":
      return (
        <Frame target={target} verdict={verdict}>
          <div className="flex items-center gap-2 p-3">
            <Avatar platform={platform} />
            <div>
              <p className="font-semibold">{handle}</p>
              <p className="text-[11px] text-neutral-500">Just now · 🌍</p>
            </div>
          </div>
          {caption && <p className="px-3 pb-3 whitespace-pre-wrap">{caption}</p>}
          {image && <Img src={image} className="aspect-square" />}
          <div className="flex justify-around border-t border-neutral-200 py-2 text-neutral-500">
            <span>Like</span>
            <span>Comment</span>
            <span>Share</span>
          </div>
        </Frame>
      );
    case "INSTAGRAM": {
      const short = caption.length > 125 ? `${caption.slice(0, 125).trimEnd()}… ` : caption;
      return (
        <Frame target={target} verdict={verdict}>
          <div className="flex items-center gap-2 p-2.5">
            <Avatar platform={platform} />
            <p className="font-semibold">{handle.replace(/^@/, "")}</p>
          </div>
          <Img src={image} className="aspect-square" />
          <p className="p-3">
            <span className="font-semibold">{handle.replace(/^@/, "")}</span> {short}
            {caption.length > 125 && <span className="text-neutral-500">more</span>}
          </p>
        </Frame>
      );
    }
    case "WHATSAPP":
      return (
        <Frame target={target} verdict={verdict}>
          <div className="bg-[#efeae2] p-3">
            <div className="max-w-[85%] overflow-hidden rounded-lg bg-white shadow-sm">
              {image && <Img src={image} className="aspect-square" />}
              <p className="p-2.5 whitespace-pre-wrap">
                Hi Amina, {caption.replace(/\s+/g, " ").trim()}
              </p>
              <p className="px-2.5 pb-2 text-[11px] text-neutral-500">Reply STOP to unsubscribe</p>
            </div>
            <p className="mt-1.5 text-[11px] text-neutral-500">From {handle} · each subscriber sees their own name</p>
          </div>
        </Frame>
      );
    case "X": {
      const n = [...caption].reduce((acc, ch) => acc + (ch.codePointAt(0)! > 0x10ff ? 2 : 1), 0);
      return (
        <Frame target={target} verdict={verdict}>
          <div className="flex gap-2.5 p-3">
            <Avatar platform={platform} />
            <div className="min-w-0 flex-1">
              <p>
                <span className="font-semibold">{handle.replace(/^@/, "")}</span> <span className="text-neutral-500">{handle} · now</span>
              </p>
              <p className="mt-0.5 whitespace-pre-wrap">{caption}</p>
              {image && <Img src={image} className="mt-2 aspect-video rounded-xl" />}
              <p className={`mt-1 text-right text-[11px] ${n > 280 ? "text-red-600" : "text-neutral-500"}`}>{n}/280</p>
            </div>
          </div>
        </Frame>
      );
    }
    case "TIKTOK":
      return (
        <Frame target={target} verdict={verdict}>
          <div className="relative mx-auto aspect-[9/16] max-h-96 bg-black text-white">
            <Img src={image} className="h-full opacity-95" />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 p-3">
              <p className="font-semibold">{handle}</p>
              <p className="line-clamp-3 text-xs">{caption}</p>
            </div>
          </div>
        </Frame>
      );
  }
}

export function AdvertPreview({
  title,
  about,
  caption,
  image,
  targets,
  verdicts,
}: {
  title: string;
  about: string;
  caption: string;
  image: string | null;
  targets: PreviewTarget[];
  verdicts: PlatformVerdict[];
}) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold">On the website, where users subscribe</h3>
        <article className="glass mt-2 max-w-xs overflow-hidden rounded-[24px]">
          {image && <Img src={image} className="aspect-square" />}
          <div className="p-4">
            <p className="font-semibold">{title || <span className="text-danger">Add a title</span>}</p>
            {about && <p className="mt-1 text-sm text-ink-soft">{about}</p>}
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {targets.map((t) => (
                <li key={t.platform} className="flex items-center gap-1 rounded-full border border-line py-0.5 pr-2.5 pl-0.5 text-xs">
                  <PlatformBadge platform={t.platform} /> {t.handle}
                </li>
              ))}
            </ul>
          </div>
        </article>
      </section>
      <section>
        <h3 className="text-sm font-semibold">On each platform</h3>
        {targets.length === 0 ? (
          <p className="mt-2 text-sm text-danger">Choose at least one target platform.</p>
        ) : (
          <div className="mt-3 grid gap-6 sm:grid-cols-2">
            {targets.map((t) => (
              <PostPreview key={t.platform} target={t} caption={caption} image={image} verdict={verdicts.find((v) => v.platform === t.platform)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
