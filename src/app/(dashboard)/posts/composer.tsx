"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Platform, PostFormat } from "@prisma/client";
import { PlatformBadge, platforms } from "@/components/platforms";
import type { AdvertImage, ImageResult } from "@/lib/advert-images";
import type { Issue } from "@/lib/policy/rules";
import type { PlatformOutcome } from "@/lib/adverts";
import { cancelPost, generatePostImage, schedulePostAction } from "./actions";

export type PlatformChoice = { platform: Platform; handle: string | null; disabledReason: string | null; story: { supported: boolean; reason?: string } };

const field = "w-full rounded-2xl border border-line bg-white/50 px-4 py-3 placeholder:text-ink-soft/70 dark:bg-white/5";
const chip =
  "inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm peer-checked:border-transparent peer-checked:bg-ink peer-checked:text-white peer-disabled:opacity-45 peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--ig-3)] dark:peer-checked:bg-white dark:peer-checked:text-ink";
const ghost = "rounded-full border border-line bg-white/50 px-4 py-2 text-sm font-medium hover:bg-white/80 disabled:opacity-50 dark:bg-white/10";

// "2026-10-24T09:30" in the browser's time zone, for the datetime input's minimum
const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

// Schedule a post or story on your own accounts, for your followers.
export function PostComposer({ choices }: { choices: PlatformChoice[] }) {
  const router = useRouter();
  const [format, setFormat] = useState<PostFormat>("POST");
  const [selected, setSelected] = useState<Platform[]>([]);
  const [caption, setCaption] = useState("");
  const [tab, setTab] = useState<"ai" | "upload">("ai");
  const [prompt, setPrompt] = useState("");
  const [media, setMedia] = useState<AdvertImage | null>(null);
  const [when, setWhen] = useState<"now" | "later">("later");
  const [sendAt, setSendAt] = useState("");
  const [busy, setBusy] = useState<"photo" | "schedule" | null>(null);
  const [error, setError] = useState<{ message: string; issues?: Issue[] } | null>(null);
  const [outcomes, setOutcomes] = useState<PlatformOutcome[] | null>(null);
  const [, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // A platform can be picked if it's connected and (for stories) supports them.
  const unavailable = (c: PlatformChoice) => c.disabledReason ?? (format === "STORY" && !c.story.supported ? c.story.reason ?? "No stories" : null);
  const picked = selected.filter((p) => !unavailable(choices.find((c) => c.platform === p)!));

  const run = (kind: NonNullable<typeof busy>, task: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    setOutcomes(null);
    start(async () => {
      try {
        await task();
      } catch {
        setError({ message: `${kind === "schedule" ? "Not scheduled" : "No photo"}: the server didn't respond. Check your connection and try again.` });
      } finally {
        setBusy(null);
      }
    });
  };
  const apply = (res: ImageResult) => (res.ok ? setMedia(res.media) : setError({ message: res.error, issues: res.issues }));

  const createPhoto = () => run("photo", async () => apply(await generatePostImage(prompt, picked, format)));
  const upload = () =>
    run("photo", async () => {
      const file = fileRef.current?.files?.[0];
      if (!file) return setError({ message: "Choose a photo first." });
      const body = new FormData();
      body.set("file", file);
      body.set("platform", picked.includes("INSTAGRAM") ? "INSTAGRAM" : picked[0] ?? "FACEBOOK");
      body.set("format", format);
      body.set("caption", caption);
      apply((await (await fetch("/api/uploads", { method: "POST", body })).json()) as ImageResult);
      if (fileRef.current) fileRef.current.value = "";
    });

  const schedule = () =>
    run("schedule", async () => {
      if (when === "later" && !sendAt) return setError({ message: "Not scheduled: pick the date and time, or choose Now." });
      const res = await schedulePostAction({
        platforms: picked,
        format,
        caption,
        mediaId: media && !media.blocked ? media.id : null,
        sendAt: when === "later" ? new Date(sendAt).toISOString() : null,
      });
      if (!res.ok) return setError({ message: `Not scheduled: ${res.error}` });
      setOutcomes(res.outcomes);
      if (res.scheduled) {
        setCaption("");
        setMedia(null);
        setPrompt("");
        router.refresh();
      }
    });

  const problem =
    picked.length === 0 ? "Choose at least one platform." : !caption.trim() && !media ? "Add a caption or a photo." : when === "later" && !sendAt ? "Pick a date and time." : null;

  return (
    <section className="glass space-y-5 rounded-[28px] p-6" aria-labelledby="compose-h">
      <div>
        <h2 id="compose-h" className="text-lg font-semibold">Schedule a post</h2>
        <p className="text-sm text-ink-soft">Posted on your own accounts for your followers to see. Each platform&rsquo;s rules are checked first.</p>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Type</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["POST", "STORY"] as const).map((f) => (
            <label key={f} className="cursor-pointer">
              <input type="radio" name="format" checked={format === f} onChange={() => setFormat(f)} className="peer sr-only" />
              <span className={chip}>{f === "POST" ? "Post (feed)" : "Story / status (24 hours)"}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium">Where</legend>
        <ul className="mt-2 flex flex-wrap gap-2">
          {choices.map((c) => {
            const reason = unavailable(c);
            return (
              <li key={c.platform}>
                <label className={`block ${reason ? "cursor-not-allowed" : "cursor-pointer"}`} title={reason ?? undefined}>
                  <input
                    type="checkbox"
                    disabled={!!reason}
                    checked={!reason && selected.includes(c.platform)}
                    onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.platform] : s.filter((p) => p !== c.platform)))}
                    className="peer sr-only"
                  />
                  <span className={chip}>
                    <PlatformBadge platform={c.platform} />
                    {platforms[c.platform].name}
                    {c.handle && <span className="text-xs opacity-75">{c.handle}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <ul className="mt-2 space-y-0.5 text-xs text-ink-soft">
          {choices.filter(unavailable).map((c) => (
            <li key={c.platform}>
              <span className="font-medium">{platforms[c.platform].name}:</span> {unavailable(c)}
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="space-y-2">
        <div role="tablist" aria-label="Photo" className="flex gap-1">
          {(["ai", "upload"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-full px-3.5 py-1.5 text-sm ${tab === t ? "bg-ink text-white dark:bg-white dark:text-ink" : "text-ink-soft hover:text-ink"}`}
            >
              {t === "ai" ? "Create with AI" : "Upload a photo"}
            </button>
          ))}
        </div>
        {tab === "ai" ? (
          <div className="flex flex-wrap gap-2">
            <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the photo, e.g. a sunny shop front with fresh fruit" aria-label="Describe the photo" className={`${field} min-w-0 flex-1`} />
            <button type="button" onClick={createPhoto} disabled={busy !== null || prompt.trim().length < 3} className="blend-meta rounded-full px-5 py-2 text-sm font-medium text-white shadow-md disabled:opacity-50">
              {busy === "photo" ? "Creating… (up to a minute)" : "Create photo"}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Photo to upload" className="min-w-0 flex-1 text-sm text-ink-soft file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:text-sm file:font-medium file:text-white dark:file:bg-white dark:file:text-ink" />
            <button type="button" onClick={upload} disabled={busy !== null} className={ghost}>
              {busy === "photo" ? "Uploading and checking…" : "Upload photo"}
            </button>
          </div>
        )}
        {format === "STORY" && <p className="text-xs text-ink-soft">Stories need a photo; tall 9:16 photos work best.</p>}
        {media &&
          (media.blocked ? (
            <p className="text-sm text-danger">This photo breaks the content rules on every platform, so it can&rsquo;t be used. Try another.</p>
          ) : (
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={media.url} alt="Post photo" width={media.width} height={media.height} className="max-h-48 w-auto rounded-xl" />
              <button type="button" onClick={() => setMedia(null)} className="text-sm text-ink-soft hover:text-danger">
                Remove
              </button>
            </div>
          ))}
      </div>

      <label className="block">
        <span className="text-sm font-medium">Caption</span>
        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} placeholder="Open late this Friday. Come say hi!" className={`mt-1 ${field}`} />
      </label>

      <fieldset>
        <legend className="text-sm font-medium">When</legend>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {(["now", "later"] as const).map((w) => (
            <label key={w} className="cursor-pointer">
              <input type="radio" name="post-when" checked={when === w} onChange={() => setWhen(w)} className="peer sr-only" />
              <span className={chip}>{w === "now" ? "Now" : "At a set time"}</span>
            </label>
          ))}
          {when === "later" && (
            <input type="datetime-local" value={sendAt} min={localNow()} onChange={(e) => setSendAt(e.target.value)} aria-label="Date and time to post" className="rounded-full border border-line bg-white/50 px-3 py-1.5 text-sm dark:bg-white/5" />
          )}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={schedule} disabled={busy !== null || !!problem} className="blend-meta rounded-full px-6 py-2.5 font-medium text-white shadow-md shadow-fuchsia-500/25 disabled:opacity-50">
          {busy === "schedule" ? "Checking and scheduling…" : when === "now" ? "Post now" : "Schedule"}
        </button>
        {problem && <span className="text-sm text-ink-soft">{problem}</span>}
      </div>

      {error && (
        <div role="alert" className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm">
          <p className="font-medium text-danger">{error.message}</p>
          {error.issues?.map((i) => <p key={i.code}>{i.message}</p>)}
        </div>
      )}
      {outcomes && (
        <ul role="status" className="space-y-1 text-sm">
          {outcomes.map((o, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${o.ok ? "bg-wa" : "bg-danger"}`} />
              <span className={o.ok ? "" : "text-danger"}>{o.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CancelPost({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => confirm("Cancel this scheduled post?") && start(async () => setError((await cancelPost(id)).error))}
        className="text-xs text-ink-soft hover:text-danger"
      >
        {pending ? "Cancelling…" : "Cancel"}
      </button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  );
}
