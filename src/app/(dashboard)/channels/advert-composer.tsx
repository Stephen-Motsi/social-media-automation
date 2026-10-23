"use client";

import { useRef, useState, useTransition } from "react";
import type { Platform } from "@prisma/client";
import { platforms } from "@/components/platforms";
import type { Issue, PlatformVerdict } from "@/lib/policy/rules";
import type { AdvertImage, ImageResult } from "@/lib/advert-images";
import { generateForChannel, refineForChannel } from "./actions";

export type ComposerAdvert = {
  id: string;
  title: string;
  about: string;
  caption: string;
  media: AdvertImage | null;
  prompt: string;
  listed: boolean;
};

const field = "w-full rounded-xl border border-line bg-white/55 px-3 py-2 dark:bg-white/5";
const statusCopy: Record<PlatformVerdict["status"], { label: string; className: string }> = {
  pass: { label: "Ready to post", className: "bg-wa/15 text-emerald-700 dark:text-emerald-300" },
  warn: { label: "Check before posting", className: "bg-amber-400/20 text-amber-800 dark:text-amber-200" },
  block: { label: "Can't post", className: "bg-danger/15 text-danger" },
};

// The social container's advert: create the photo from a prompt (or upload one), refine it,
// and write the title and caption. Saved together with the schedule (hidden fields below).
export function AdvertComposer({
  channelId,
  platform,
  uploadHint,
  initial,
  disabled,
}: {
  channelId: string;
  platform: Platform;
  uploadHint: string;
  initial: ComposerAdvert | null;
  disabled: boolean;
}) {
  const name = platforms[platform].name;
  const [tab, setTab] = useState<"ai" | "upload">(initial?.media && !initial.prompt ? "upload" : "ai");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [refine, setRefine] = useState("");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [about, setAbout] = useState(initial?.about ?? "");
  const [caption, setCaption] = useState(initial?.caption ?? "");
  const [media, setMedia] = useState<AdvertImage | null>(initial?.media ?? null);
  const [verdict, setVerdict] = useState<PlatformVerdict | null>(null);
  const [error, setError] = useState<{ message: string; issues?: Issue[] } | null>(null);
  const [busy, setBusy] = useState<"create" | "refine" | "upload" | null>(null);
  const [, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const apply = (res: ImageResult) => {
    if (!res.ok) return setError({ message: res.error, issues: res.issues });
    setMedia(res.media);
    setVerdict(res.verdict);
    setRefine("");
  };
  const run = (kind: NonNullable<typeof busy>, task: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    start(async () => {
      try {
        await task();
      } catch {
        setError({ message: "Something went wrong. Try again." });
      } finally {
        setBusy(null);
      }
    });
  };

  const create = () => run("create", async () => apply(await generateForChannel(channelId, prompt, caption)));
  const doRefine = () =>
    run("refine", async () => {
      if (media) apply(await refineForChannel(channelId, media.id, refine, caption));
    });
  const upload = () =>
    run("upload", async () => {
      const file = fileRef.current?.files?.[0];
      if (!file) return setError({ message: "Choose a photo first." });
      const body = new FormData();
      body.set("file", file);
      body.set("channelId", channelId);
      body.set("caption", caption);
      apply((await (await fetch("/api/uploads", { method: "POST", body })).json()) as ImageResult);
      if (fileRef.current) fileRef.current.value = "";
    });

  const tabButton = (t: typeof tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === t}
      onClick={() => setTab(t)}
      className={`rounded-full px-3.5 py-1.5 text-sm ${tab === t ? "bg-ink text-white dark:bg-white dark:text-ink" : "text-ink-soft hover:text-ink"}`}
    >
      {label}
    </button>
  );

  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="font-semibold">Advert</legend>
      {/* Saved together with the schedule */}
      <input type="hidden" name="advertComposer" value="1" />
      <input type="hidden" name="advertId" value={initial?.id ?? ""} />
      <input type="hidden" name="advertTitle" value={title} />
      <input type="hidden" name="advertAbout" value={about} />
      <input type="hidden" name="advertCaption" value={caption} />
      <input type="hidden" name="advertMediaId" value={media && !media.blocked ? media.id : ""} />

      <div role="tablist" aria-label="Advert photo" className="flex gap-1">
        {tabButton("ai", "Create with AI")}
        {tabButton("upload", "Upload a photo")}
      </div>

      {tab === "ai" ? (
        <div className="space-y-2">
          <label className="block text-sm">
            <span className="text-xs font-medium">Describe the advert photo</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="A bright flat-lay of fresh mangoes on a turquoise table, morning light, no text"
              className={field}
            />
          </label>
          <button
            type="button"
            onClick={create}
            disabled={busy !== null || prompt.trim().length < 3}
            className={`${platforms[platform].blend} rounded-full px-4 py-2 text-sm font-medium text-white shadow-md disabled:opacity-50`}
          >
            {busy === "create" ? "Creating… (up to a minute)" : media ? "Create a new image" : "Create image"}
          </button>
          <p className="text-xs text-ink-soft">Made in the shape {name} shows best, and checked against {name}&rsquo;s rules.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Photo to upload" className="block w-full text-sm text-ink-soft file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:text-sm file:font-medium file:text-white dark:file:bg-white dark:file:text-ink" />
          <p className="text-xs text-ink-soft">{uploadHint} Photos are also checked for content {name} doesn&rsquo;t allow.</p>
          <button
            type="button"
            onClick={upload}
            disabled={busy !== null}
            className="rounded-full border border-line bg-white/50 px-4 py-2 text-sm font-medium hover:bg-white/80 disabled:opacity-50 dark:bg-white/10"
          >
            {busy === "upload" ? "Uploading and checking…" : "Upload photo"}
          </button>
        </div>
      )}

      {media && (
        <div className="space-y-2 rounded-2xl border border-line bg-white/30 p-3 dark:bg-white/[0.03]">
          {media.blocked ? (
            <p className="text-sm text-danger">This photo breaks the content rules on every platform, so it&rsquo;s hidden. Try another.</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={media.url} alt="Advert photo" width={media.width} height={media.height} className="max-h-72 w-auto rounded-xl" />
          )}
          {!media.blocked && (
            <div className="flex flex-wrap gap-2">
              <input
                value={refine}
                onChange={(e) => setRefine(e.target.value)}
                placeholder="Refine it: e.g. brighter background, add a woven basket"
                aria-label="How to refine the photo"
                className={`${field} min-w-0 flex-1`}
              />
              <button
                type="button"
                onClick={doRefine}
                disabled={busy !== null || refine.trim().length < 3}
                className="rounded-full border border-line bg-white/50 px-4 py-2 text-sm font-medium hover:bg-white/80 disabled:opacity-50 dark:bg-white/10"
              >
                {busy === "refine" ? "Refining…" : "Refine"}
              </button>
            </div>
          )}
        </div>
      )}

      {verdict && (
        <div className="text-sm">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusCopy[verdict.status].className}`}>{statusCopy[verdict.status].label}</span>
          {verdict.issues.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-xs text-ink-soft">
              {verdict.issues.map((i) => (
                <li key={i.code} className="flex gap-1.5">
                  <span aria-hidden className={`mt-1.5 size-1.5 shrink-0 rounded-full ${i.severity === "block" ? "bg-danger" : "bg-amber-500"}`} />
                  {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && (
        <div role="alert" className="text-sm text-danger">
          {error.message}
          {error.issues?.map((i) => (
            <p key={i.code} className="text-xs">
              {i.message}
            </p>
          ))}
        </div>
      )}

      <label className="block text-sm">
        <span className="text-xs font-medium">Title users see</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Fresh mango season" className={field} />
      </label>
      <label className="block text-sm">
        <span className="text-xs font-medium">What it&rsquo;s about (optional)</span>
        <input value={about} onChange={(e) => setAbout(e.target.value)} maxLength={500} placeholder="Sweet Makueni mangoes delivered across Nairobi" className={field} />
      </label>
      <label className="block text-sm">
        <span className="text-xs font-medium">Caption</span>
        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} placeholder="Mango season is here! Order on WhatsApp today." className={field} />
      </label>
      <p className="text-xs text-ink-soft">
        {initial?.listed
          ? `Listed: users can subscribe to it on ${name}.`
          : `Turn the schedule on (or use Post now) and it's listed for users to subscribe to on ${name}.`}
        {platform === "X" && " X rejects a post that repeats a recent one, so a repeating schedule needs a refreshed advert each time."}
      </p>
    </fieldset>
  );
}
