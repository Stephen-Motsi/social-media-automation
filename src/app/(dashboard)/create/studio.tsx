"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Platform } from "@prisma/client";
import type { ImageShape } from "@/lib/ai/openai";
import type { Issue, PlatformVerdict } from "@/lib/policy/rules";
import { PlatformBadge, platforms } from "@/components/platforms";
import { checkAction, generateAction, saveDraftAction, type GeneratedMedia } from "./actions";

const shapes: { value: ImageShape; label: string; hint: string; box: string }[] = [
  { value: "square", label: "Square", hint: "Works everywhere", box: "h-5 w-5" },
  { value: "landscape", label: "Landscape", hint: "3:2, works everywhere", box: "h-4 w-6" },
  { value: "portrait", label: "Portrait", hint: "2:3, too tall for Instagram", box: "h-6 w-4" },
];

const statusCopy: Record<PlatformVerdict["status"], { label: string; className: string }> = {
  pass: { label: "Ready to post", className: "bg-wa/15 text-emerald-700 dark:text-emerald-300" },
  warn: { label: "Check before posting", className: "bg-amber-400/20 text-amber-800 dark:text-amber-200" },
  block: { label: "Can't post", className: "bg-danger/15 text-danger" },
};

const field =
  "w-full rounded-2xl border border-line bg-white/50 px-4 py-3 placeholder:text-ink-soft/70 dark:bg-white/5";

export function Studio({
  interests,
  channelPlatforms,
}: {
  interests: { id: string; name: string }[];
  // Platforms that have a social container (with handle) the advert can target
  channelPlatforms: { platform: Platform; handle: string }[];
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [shape, setShape] = useState<ImageShape>("square");
  const [caption, setCaption] = useState("");
  const [media, setMedia] = useState<GeneratedMedia | null>(null);
  const [verdicts, setVerdicts] = useState<PlatformVerdict[] | null>(null);
  const [checkedCaption, setCheckedCaption] = useState("");
  const [error, setError] = useState<{ message: string; issues?: Issue[] } | null>(null);
  const [busy, setBusy] = useState<"generate" | "check" | "save" | null>(null);
  const [topics, setTopics] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [about, setAbout] = useState("");
  const [targetPlatforms, setTargetPlatforms] = useState<Platform[]>(channelPlatforms.map((c) => c.platform));
  const [towns, setTowns] = useState("");
  const [, startTransition] = useTransition();

  const stale = verdicts !== null && caption !== checkedCaption;

  function run(kind: NonNullable<typeof busy>, task: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    startTransition(async () => {
      try {
        await task();
      } catch {
        setError({ message: "Something went wrong. Try again." });
      } finally {
        setBusy(null);
      }
    });
  }

  const generate = () =>
    run("generate", async () => {
      const res = await generateAction({ prompt, shape });
      if (!res.ok) return setError({ message: res.error, issues: res.issues });
      setMedia(res.media);
      // Re-check with the current caption so results cover image + caption together
      const checked = caption.trim() ? await checkAction({ mediaId: res.media.id, caption }) : null;
      setVerdicts(checked?.ok ? checked.verdicts : res.verdicts);
      setCheckedCaption(caption);
    });

  const check = () =>
    run("check", async () => {
      const res = await checkAction({ mediaId: media?.id, caption });
      if (!res.ok) return setError({ message: res.error });
      setVerdicts(res.verdicts);
      setCheckedCaption(caption);
    });

  const save = () =>
    run("save", async () => {
      const res = await saveDraftAction({
        mediaId: media?.id,
        caption,
        interestIds: topics,
        title,
        about,
        targetPlatforms,
        locations: towns.split(","),
      });
      if (!res.ok) {
        setError({ message: res.error });
        return;
      }
      setVerdicts(res.verdicts);
      // Adverts for subscribers go to Approvals; others are used in Channels.
      router.push("/admin/adverts");
    });

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-2">
      <section className="glass space-y-6 rounded-[28px] p-6">
        <div className="space-y-3">
          <label className="block">
            <span className="font-medium">Advert title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekend phone sale" maxLength={120} className={`mt-2 ${field}`} />
          </label>
          <label className="block">
            <span className="font-medium">What it&rsquo;s about</span>
            <span className="block text-sm text-ink-soft">Shown to users when they choose adverts to subscribe to.</span>
            <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={2} maxLength={500} placeholder="20% off smartphones at our Westlands shop, Friday to Sunday." className={`mt-2 ${field}`} />
          </label>
          <fieldset>
            <legend className="font-medium">Target platforms</legend>
            {channelPlatforms.length === 0 ? (
              <p className="mt-1 text-sm text-ink-soft">Add containers on Channels first; each platform needs a handle.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {channelPlatforms.map((c) => (
                  <label key={c.platform} className="cursor-pointer">
                    <input
                      type="checkbox"
                      checked={targetPlatforms.includes(c.platform)}
                      onChange={(e) => setTargetPlatforms((t) => (e.target.checked ? [...t, c.platform] : t.filter((x) => x !== c.platform)))}
                      className="peer sr-only"
                    />
                    <span className="inline-block rounded-full border border-line px-3 py-1.5 text-sm peer-checked:border-transparent peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--ig-3)] dark:peer-checked:bg-white dark:peer-checked:text-ink">
                      {c.handle}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        </div>

        <div>
          <label htmlFor="prompt" className="font-medium">
            Image
          </label>
          <textarea
            id="prompt"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="A bright flat-lay of fresh mangoes and passion fruit on a turquoise table, morning light"
            className={`mt-2 ${field}`}
          />
          <fieldset className="mt-3">
            <legend className="sr-only">Shape</legend>
            <div className="flex flex-wrap gap-2">
              {shapes.map((s) => (
                <label
                  key={s.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    shape === s.value
                      ? "border-transparent bg-ink text-white dark:bg-white dark:text-ink"
                      : "border-line text-ink-soft hover:text-ink"
                  }`}
                >
                  <input
                    type="radio"
                    name="shape"
                    value={s.value}
                    checked={shape === s.value}
                    onChange={() => setShape(s.value)}
                    className="sr-only"
                  />
                  <span aria-hidden className={`${s.box} rounded-[3px] border-2 border-current`} />
                  {s.label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-sm text-ink-soft">{shapes.find((s) => s.value === shape)?.hint}</p>
          </fieldset>
          <button
            type="button"
            onClick={generate}
            disabled={busy !== null || prompt.trim().length < 3}
            className="blend-meta mt-4 rounded-full px-5 py-2.5 font-medium text-white shadow-md shadow-fuchsia-500/25 disabled:opacity-50"
          >
            {busy === "generate" ? "Generating… (up to a minute)" : media ? "Generate again" : "Generate image"}
          </button>
        </div>

        <div>
          <label htmlFor="caption" className="font-medium">
            Caption
          </label>
          <textarea
            id="caption"
            rows={5}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Fresh from the market this morning 🥭 #FreshFruit"
            className={`mt-2 ${field}`}
          />
          <div className="mt-1 text-right text-xs text-ink-soft tabular-nums">{caption.length.toLocaleString()} characters</div>
          {interests.length > 0 && (
            <fieldset className="mt-5">
              <legend className="font-medium">Send to subscribers on WhatsApp</legend>
              <p className="mt-0.5 text-sm text-ink-soft">
                Subscribers interested in these topics are matched automatically. You approve before anything is sent.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {interests.map((i) => (
                  <label key={i.id} className="cursor-pointer">
                    <input
                      type="checkbox"
                      checked={topics.includes(i.id)}
                      onChange={(e) => setTopics((t) => (e.target.checked ? [...t, i.id] : t.filter((x) => x !== i.id)))}
                      className="peer sr-only"
                    />
                    <span className="inline-block rounded-full border border-line px-3 py-1.5 text-sm transition-colors peer-checked:border-transparent peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--ig-3)] dark:peer-checked:bg-white dark:peer-checked:text-ink">
                      {i.name}
                    </span>
                  </label>
                ))}
              </div>
              {topics.length > 0 && (
                <label className="mt-3 block text-sm">
                  <span className="text-xs font-medium">Only these towns (optional, comma-separated)</span>
                  <input value={towns} onChange={(e) => setTowns(e.target.value)} placeholder="Nairobi, Thika" className={`mt-1 ${field}`} />
                </label>
              )}
            </fieldset>
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={check}
              disabled={busy !== null || (!caption.trim() && !media)}
              className="rounded-full border border-line bg-white/50 px-5 py-2.5 font-medium transition-colors hover:bg-white/80 disabled:opacity-50 dark:bg-white/10 dark:hover:bg-white/20"
            >
              {busy === "check" ? "Checking…" : "Check post"}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy !== null || (!caption.trim() && !media)}
              className="rounded-full bg-ink px-5 py-2.5 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-ink"
            >
              {busy === "save" ? "Saving…" : "Save as draft"}
            </button>
          </div>
        </div>

        {error && (
          <div role="alert" className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm">
            <p className="font-medium text-danger">{error.message}</p>
            {error.issues && error.issues.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {error.issues.map((i) => (
                  <li key={i.code}>{i.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <div className="space-y-6">
        <section className="glass overflow-hidden rounded-[28px]">
          {media?.blocked ? (
            <div className="flex aspect-square flex-col items-center justify-center gap-2 p-10 text-center">
              <p className="font-medium text-danger">Image hidden</p>
              <p className="max-w-xs text-ink-soft">
                This image breaks the content rules on every platform, so it won’t be shown or published. Change the
                description and generate again.
              </p>
            </div>
          ) : media ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={media.url}
              alt={prompt}
              width={media.width}
              height={media.height}
              className="h-auto w-full"
            />
          ) : (
            <div className="flex aspect-square items-center justify-center p-10 text-center text-ink-soft">
              {busy === "generate" ? "Creating your image…" : "Your image appears here."}
            </div>
          )}
        </section>

        <section className="glass rounded-[28px] p-6" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Platform check</h2>
            {stale && <span className="text-sm text-ink-soft">Caption changed. Check again.</span>}
          </div>
          {!verdicts ? (
            <p className="mt-3 text-ink-soft">
              Each platform has its own rules on image shape, file type, caption length and content. Results show here
              after you generate an image or check your post.
            </p>
          ) : (
            <ul className={`mt-4 space-y-4 ${stale ? "opacity-60" : ""}`}>
              {verdicts.map((v) => (
                <li key={v.platform}>
                  <div className="flex items-center gap-3">
                    <PlatformBadge platform={v.platform} />
                    <span className="font-medium">
                      {platforms[v.platform].name}
                      {v.format === "STORY" && <span className="font-normal text-ink-soft"> story</span>}
                    </span>
                    <span className={`ml-auto rounded-full px-3 py-1 text-xs font-medium ${statusCopy[v.status].className}`}>
                      {statusCopy[v.status].label}
                    </span>
                  </div>
                  {v.issues.length > 0 && (
                    <ul className="mt-2 space-y-1 pl-10 text-sm text-ink-soft">
                      {v.issues.map((i) => (
                        <li key={i.code} className="flex gap-2">
                          <span
                            aria-hidden
                            className={`mt-1.5 size-1.5 shrink-0 rounded-full ${i.severity === "block" ? "bg-danger" : "bg-amber-500"}`}
                          />
                          {i.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
