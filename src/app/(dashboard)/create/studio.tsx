"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Platform, PostFormat } from "@prisma/client";
import type { ImageShape } from "@/lib/ai/openai";
import type { Issue, PlatformVerdict } from "@/lib/policy/rules";
import { advertImagePrompt, shapeFor } from "@/lib/advert-prompt";
import { PlatformBadge, platforms } from "@/components/platforms";
import { checkAction, generateAction, saveDraftAction, type GeneratedMedia } from "./actions";
import { publish as publishAdvert } from "../admin/actions";
import type { PlatformOutcome } from "@/lib/adverts";
import { homeUrl, STILL_POSTING, waitUntilPosted } from "../admin/publish-progress";
import { AdvertPreview } from "./preview";

export type ChannelOption = { platform: Platform; label: string; handle: string; format: PostFormat; connected: boolean };
export type DraftInput = {
  id: string;
  title: string;
  about: string;
  caption: string;
  topics: string[];
  towns: string;
  targetPlatforms: Platform[];
  media: GeneratedMedia | null;
  prompt: string;
  listed: boolean;
};

const shapes: { value: ImageShape; label: string; hint: string; box: string }[] = [
  { value: "square", label: "Square", hint: "Works on every platform", box: "h-5 w-5" },
  { value: "landscape", label: "Landscape", hint: "3:2, works on every platform", box: "h-4 w-6" },
  { value: "portrait", label: "Portrait", hint: "2:3, for stories; too tall for Instagram posts", box: "h-6 w-4" },
];

const statusCopy: Record<PlatformVerdict["status"], { label: string; className: string }> = {
  pass: { label: "Ready", className: "bg-wa/15 text-emerald-700 dark:text-emerald-300" },
  warn: { label: "Check", className: "bg-amber-400/20 text-amber-800 dark:text-amber-200" },
  block: { label: "Can't post", className: "bg-danger/15 text-danger" },
};

// New adverts start with the connected platforms (all of them if none is connected yet).
const defaultTargets = (channels: ChannelOption[]) =>
  (channels.some((c) => c.connected) ? channels.filter((c) => c.connected) : channels).map((c) => c.platform);

// "2026-10-24T09:30" in the browser's time zone, for the datetime input's minimum
function localNow() {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

const field = "w-full rounded-2xl border border-line bg-white/50 px-4 py-3 placeholder:text-ink-soft/70 dark:bg-white/5";
const chip =
  "inline-block rounded-full border border-line px-3 py-1.5 text-sm peer-checked:border-transparent peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--ig-3)] dark:peer-checked:bg-white dark:peer-checked:text-ink";

export function Studio({
  interests,
  channels,
  draft,
  scheduleFirst = false,
}: {
  interests: { id: string; name: string }[];
  // Platforms with a social container (and handle) the advert can target
  channels: ChannelOption[];
  draft?: DraftInput;
  // Opened from "Schedule…": start with a send time
  scheduleFirst?: boolean;
}) {
  const router = useRouter();
  const [draftId, setDraftId] = useState(draft?.id);
  const [listed] = useState(draft?.listed ?? false);
  const [title, setTitle] = useState(draft?.title ?? "");
  const [about, setAbout] = useState(draft?.about ?? "");
  const [caption, setCaption] = useState(draft?.caption ?? "");
  const [topics, setTopics] = useState<string[]>(draft?.topics ?? []);
  const [towns, setTowns] = useState(draft?.towns ?? "");
  const [targetPlatforms, setTargetPlatforms] = useState<Platform[]>(draft?.targetPlatforms ?? defaultTargets(channels));
  const [prompt, setPrompt] = useState(draft?.prompt ?? "");
  const [shape, setShape] = useState<ImageShape>(() =>
    shapeFor(channels.filter((c) => (draft?.targetPlatforms ?? defaultTargets(channels)).includes(c.platform))),
  );
  const [media, setMedia] = useState<GeneratedMedia | null>(draft?.media ?? null);
  const [verdicts, setVerdicts] = useState<PlatformVerdict[] | null>(null);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [when, setWhen] = useState<"now" | "later">(scheduleFirst ? "later" : "now");
  const [sendAt, setSendAt] = useState("");
  const [autoSend, setAutoSend] = useState(true);
  const [report, setReport] = useState<PlatformOutcome[] | null>(null);
  // Shown on the publish button once it has gone out (or been scheduled), just before going home
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; issues?: Issue[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"photo" | "check" | "save" | "publish" | null>(null);
  const [, startTransition] = useTransition();

  const targets = channels.filter((c) => targetPlatforms.includes(c.platform));
  const topicNames = interests.filter((i) => topics.includes(i.id)).map((i) => i.name);
  const autoPrompt = advertImagePrompt({ title, about, caption, topics: topicNames });

  function run(kind: NonNullable<typeof busy>, task: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    setNotice(null);
    setReport(null);
    startTransition(async () => {
      try {
        await task();
      } catch {
        const what = kind === "save" ? "Not saved" : kind === "publish" ? "Not published" : "That didn't work";
        setError({ message: `${what}: the server didn't respond. Check your connection and try again.` });
      } finally {
        setBusy(null);
      }
    });
  }

  const draftPayload = () => ({
    id: draftId,
    mediaId: media && !media.blocked ? media.id : null,
    caption,
    interestIds: topics,
    title,
    about,
    targetPlatforms,
    locations: towns.split(","),
  });

  // "Create photo": builds the prompt from the advert's details (or uses the edited one) and generates it.
  const createPhoto = (usePrompt: string) =>
    run("photo", async () => {
      if (!usePrompt.trim()) return setError({ message: "Add a title or description first, so the photo has something to show." });
      setPrompt(usePrompt);
      const res = await generateAction({ prompt: usePrompt, shape, targetPlatforms });
      if (!res.ok) return setError({ message: res.error, issues: res.issues });
      setMedia(res.media);
      const checked = await checkAction({ mediaId: res.media.id, caption, targetPlatforms });
      setVerdicts(checked.ok ? checked.verdicts : res.verdicts);
    });

  const preview = () =>
    run("check", async () => {
      const res = await checkAction({ mediaId: media && !media.blocked ? media.id : undefined, caption, targetPlatforms });
      if (!res.ok) return setError({ message: res.error });
      setVerdicts(res.verdicts);
      setMode("preview");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

  const saveDraft = () =>
    run("save", async () => {
      const res = await saveDraftAction(draftPayload());
      if (!res.ok) return setError({ message: `Not saved: ${res.error}` });
      setVerdicts(res.verdicts);
      if (!draftId) router.replace(`/create?id=${res.postId}`, { scroll: false });
      setDraftId(res.postId);
      setNotice(listed ? "Saved. Users see the updated advert." : "Saved as a draft. You can come back to it from Adverts.");
    });

  const publish = () =>
    run("publish", async () => {
      if (when === "later" && !sendAt) return setError({ message: "Not published: pick the date and time it goes out, or choose Now." });
      const saved = await saveDraftAction(draftPayload());
      if (!saved.ok) return setError({ message: `Not saved: ${saved.error}` });
      setDraftId(saved.postId);
      setVerdicts(saved.verdicts);
      if (!draftId) router.replace(`/create?id=${saved.postId}`, { scroll: false });
      // The browser's local time, sent as an exact moment
      const res = await publishAdvert(saved.postId, { sendAt: when === "later" ? new Date(sendAt).toISOString() : null, autoSend });
      if (!res.ok) return setError({ message: `Saved as a draft, but not published: ${res.error}` });
      // "Now": wait until each platform has actually posted (the worker posts it).
      let outcomes = res.outcomes;
      let timedOut = false;
      if (when === "now" && outcomes.some((o) => o.ok)) {
        const progress = await waitUntilPosted(saved.postId);
        timedOut = progress.timedOut;
        // Keep the reasons for platforms that were never queued (e.g. not connected)
        outcomes = [...res.outcomes.filter((o) => !o.ok), ...progress.outcomes.filter((o) => !res.outcomes.some((r) => !r.ok && r.platform === o.platform))];
      }
      // All good: "Posted", then the advert on the home page, as users see it. Otherwise stay and show what didn't go out.
      if (!timedOut && outcomes.every((o) => o.ok)) {
        setDone(when === "now" ? "Posted ✓" : "Scheduled ✓");
        setTimeout(() => router.push(homeUrl(saved.postId)), 1200);
        return;
      }
      setNotice(timedOut ? "Published, but still posting:" : "Published, but not everywhere:");
      setReport(timedOut ? [...outcomes, { platform: outcomes[0]?.platform ?? "FACEBOOK", ok: false, message: STILL_POSTING }] : outcomes);
    });

  const socialTargets = targets.filter((t) => t.platform !== "WHATSAPP").map((t) => platforms[t.platform].name);
  const publishProblem = !title.trim()
    ? "Add a title."
    : targets.length === 0
      ? "Choose at least one target platform."
      : !caption.trim() && !media
        ? "Add a caption or a photo."
        : verdicts && targets.every((t) => verdicts.find((v) => v.platform === t.platform)?.status === "block")
          ? "It can't be posted on any of its platforms yet. See the checks."
          : null;

  const actions = (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={saveDraft} disabled={busy !== null} className="rounded-full border border-line bg-white/50 px-5 py-2.5 font-medium hover:bg-white/80 disabled:opacity-50 dark:bg-white/10">
        {busy === "save" ? "Saving…" : listed ? "Save changes" : "Save as draft"}
      </button>
      {mode === "edit" ? (
        <button type="button" onClick={preview} disabled={busy !== null || (!caption.trim() && !media)} className="rounded-full bg-ink px-5 py-2.5 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-ink">
          {busy === "check" ? "Checking…" : "Preview"}
        </button>
      ) : (
        <>
          <button type="button" onClick={() => setMode("edit")} disabled={busy !== null} className="rounded-full px-4 py-2.5 text-ink-soft hover:text-ink">
            Back to editing
          </button>
          {!listed && (
            <button
              type="button"
              onClick={publish}
              disabled={busy !== null || !!publishProblem || !!done}
              aria-live="polite"
              data-done={done ? "" : undefined}
              className={`${done ? "bg-wa" : "blend-meta"} rounded-full px-6 py-2.5 font-medium text-white shadow-md shadow-fuchsia-500/25 disabled:opacity-50 ${done ? "disabled:opacity-100" : ""}`}
            >
              {done ?? (busy === "publish" ? (when === "now" ? "Posting…" : "Scheduling…") : when === "now" ? "Post now" : "Schedule")}
            </button>
          )}
        </>
      )}
    </div>
  );

  const feedback = (
    <>
      {notice && <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">{notice}</p>}
      {report && (
        <div className="space-y-2 text-sm">
          <ul className="space-y-1">
            {report.map((o, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${o.ok ? "bg-wa" : "bg-danger"}`} />
                <span className={o.ok ? "" : "text-danger"}>{o.message}</span>
              </li>
            ))}
          </ul>
          <a href={draftId ? homeUrl(draftId) : "/"} className="inline-block font-medium underline underline-offset-2">
            See it on the home page
          </a>
        </div>
      )}
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
    </>
  );

  if (mode === "preview") {
    return (
      <div className="mt-8 space-y-6">
        <section className="glass space-y-5 rounded-[28px] p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold">Preview</h2>
            <p className="text-sm text-ink-soft">This is what users will see. Nothing has been published yet.</p>
          </div>
          <AdvertPreview title={title} about={about} caption={caption} image={media && !media.blocked ? media.url : null} targets={targets} verdicts={verdicts ?? []} />
        </section>
        <section className="glass space-y-4 rounded-[28px] p-6">
          {!listed && (
            <>
              <h2 className="font-semibold">Publish</h2>
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
                <li>It&rsquo;s listed on the home page and in users&rsquo; dashboards, where they subscribe per platform.</li>
                {targets.some((t) => t.platform === "WHATSAPP") && <li>WhatsApp subscribers get it on their own number.</li>}
              </ul>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">When it goes out</legend>
                <div className="flex flex-wrap items-center gap-2">
                  {(["now", "later"] as const).map((w) => (
                    <label key={w} className="cursor-pointer">
                      <input type="radio" name="when" checked={when === w} onChange={() => setWhen(w)} className="peer sr-only" />
                      <span className={chip}>{w === "now" ? "Now" : "At a set time"}</span>
                    </label>
                  ))}
                  {when === "later" && (
                    <input
                      type="datetime-local"
                      value={sendAt}
                      min={localNow()}
                      onChange={(e) => setSendAt(e.target.value)}
                      aria-label="Date and time it goes out"
                      className="rounded-full border border-line bg-white/50 px-3 py-1.5 text-sm dark:bg-white/5"
                    />
                  )}
                </div>
                <p className="text-xs text-ink-soft">
                  {socialTargets.length > 0 && `Posted on ${socialTargets.join(", ")} ${when === "now" ? "straight away" : "at that time"}. `}
                  Users can subscribe as soon as it&rsquo;s published.
                </p>
              </fieldset>
              {(targets.some((t) => t.platform === "WHATSAPP") || topics.length > 0) && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} className="mt-0.5 size-4 accent-[var(--ig-3)]" />
                  <span>
                    Send to WhatsApp subscribers automatically {when === "now" ? "" : "at that time "}
                    <span className="block text-xs text-ink-soft">Publishing counts as your approval. People who subscribe later get it as soon as they do. Untick to approve each send on Approvals.</span>
                  </span>
                </label>
              )}
              {publishProblem && <p className="text-sm text-danger">Can&rsquo;t publish yet: {publishProblem}</p>}
            </>
          )}
          {actions}
          {feedback}
        </section>
      </div>
    );
  }

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-2">
      <section className="glass space-y-6 rounded-[28px] p-6">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">1. Details</h2>
          <label className="block">
            <span className="font-medium">Advert title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekend phone sale" maxLength={120} className={`mt-2 ${field}`} />
          </label>
          <label className="block">
            <span className="font-medium">What it&rsquo;s about</span>
            <span className="block text-sm text-ink-soft">Shown to users, and used to create the photo.</span>
            <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={2} maxLength={500} placeholder="20% off smartphones at our Westlands shop, Friday to Sunday." className={`mt-2 ${field}`} />
          </label>
          <fieldset>
            <legend className="font-medium">Target platforms</legend>
            {channels.some((c) => !c.connected) && (
              <p className="mt-1 text-sm text-ink-soft">
                <span aria-hidden className="mr-1 inline-block size-1.5 rounded-full bg-amber-500 align-middle" />
                Not connected yet: {channels.filter((c) => !c.connected).map((c) => platforms[c.platform].name).join(", ")}. You can still choose them; type their handle on{" "}
                <a href="/channels" className="font-medium text-ink underline underline-offset-2">Channels</a> to connect before it goes out.
              </p>
            )}
            {channels.length === 0 ? (
              <p className="mt-1 text-sm text-ink-soft">Loading platforms…</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {channels.map((c) => (
                  <label key={c.platform} className="cursor-pointer">
                    <input
                      type="checkbox"
                      checked={targetPlatforms.includes(c.platform)}
                      onChange={(e) => {
                        const next = e.target.checked ? [...targetPlatforms, c.platform] : targetPlatforms.filter((x) => x !== c.platform);
                        setTargetPlatforms(next);
                        if (!media) setShape(shapeFor(channels.filter((x) => next.includes(x.platform))));
                      }}
                      className="peer sr-only"
                    />
                    <span className={chip.replace("inline-block", "inline-flex items-center gap-1.5")}>
                      <span aria-hidden className={`size-1.5 rounded-full ${c.connected ? "bg-wa" : "bg-amber-500"}`} />
                      {c.label}
                      <span className="sr-only">{c.connected ? " (connected)" : " (not connected yet)"}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          {interests.length > 0 && (
            <fieldset>
              <legend className="font-medium">
                Topics <span className="font-normal text-ink-soft">(optional)</span>
              </legend>
              <p className="text-sm text-ink-soft">Also sends it on WhatsApp to people who chose these topics.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {interests.map((i) => (
                  <label key={i.id} className="cursor-pointer">
                    <input
                      type="checkbox"
                      checked={topics.includes(i.id)}
                      onChange={(e) => setTopics((t) => (e.target.checked ? [...t, i.id] : t.filter((x) => x !== i.id)))}
                      className="peer sr-only"
                    />
                    <span className={chip}>{i.name}</span>
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
        </div>

        <div className="space-y-3 border-t border-line pt-6">
          <h2 className="text-lg font-semibold">2. Photo</h2>
          <button
            type="button"
            onClick={() => createPhoto(autoPrompt)}
            disabled={busy !== null || !autoPrompt}
            className="blend-meta w-full rounded-full px-5 py-3 font-medium text-white shadow-md shadow-fuchsia-500/25 disabled:opacity-50"
          >
            {busy === "photo" ? "Creating photo… (up to a minute)" : media ? "Create a new photo from the details" : "Create photo for this advert"}
          </button>
          {!autoPrompt && <p className="text-sm text-ink-soft">Add a title or description first.</p>}
          <details className="text-sm" open={!!prompt && prompt !== autoPrompt}>
            <summary className="cursor-pointer text-ink-soft hover:text-ink">Adjust the photo description or shape</summary>
            <textarea value={prompt || autoPrompt} onChange={(e) => setPrompt(e.target.value)} rows={4} aria-label="Photo description" className={`mt-2 ${field}`} />
            <fieldset className="mt-2">
              <legend className="sr-only">Shape</legend>
              <div className="flex flex-wrap gap-2">
                {shapes.map((s) => (
                  <label key={s.value} className="cursor-pointer">
                    <input type="radio" name="shape" checked={shape === s.value} onChange={() => setShape(s.value)} className="peer sr-only" />
                    <span className={chip.replace("inline-block", "inline-flex items-center gap-2")}>
                      <span aria-hidden className={`${s.box} inline-block shrink-0 rounded-[3px] border-2 border-current`} />
                      {s.label}
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-ink-soft">{shapes.find((s) => s.value === shape)?.hint}</p>
            </fieldset>
            <button
              type="button"
              onClick={() => createPhoto(prompt || autoPrompt)}
              disabled={busy !== null}
              className="mt-2 rounded-full border border-line bg-white/50 px-4 py-2 font-medium hover:bg-white/80 disabled:opacity-50 dark:bg-white/10"
            >
              Create photo with this description
            </button>
          </details>
        </div>

        <div className="space-y-2 border-t border-line pt-6">
          <h2 className="text-lg font-semibold">3. Caption</h2>
          <textarea
            id="caption"
            rows={5}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Smartphones 20% off this weekend at Mango Market Westlands. Show this message in store!"
            className={field}
          />
          <div className="text-right text-xs text-ink-soft tabular-nums">{caption.length.toLocaleString()} characters</div>
        </div>

        {actions}
        {feedback}
      </section>

      <div className="space-y-6">
        <section className="glass overflow-hidden rounded-[28px]">
          {media?.blocked ? (
            <div className="flex aspect-square flex-col items-center justify-center gap-2 p-10 text-center">
              <p className="font-medium text-danger">Photo hidden</p>
              <p className="max-w-xs text-ink-soft">It breaks the content rules on every platform. Change the description and create another.</p>
            </div>
          ) : media ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={media.url} alt={title || "Advert photo"} width={media.width} height={media.height} className="h-auto w-full" />
          ) : (
            <div className="flex aspect-square items-center justify-center p-10 text-center text-ink-soft">
              {busy === "photo" ? "Creating your photo…" : "The advert's photo appears here."}
            </div>
          )}
        </section>
        <section className="glass rounded-[28px] p-6" aria-live="polite">
          <h2 className="text-lg font-semibold">Platform checks</h2>
          {!verdicts ? (
            <p className="mt-2 text-sm text-ink-soft">Each target platform&rsquo;s rules are checked when you create the photo or preview the advert.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {verdicts.map((v) => (
                <li key={v.platform}>
                  <div className="flex items-center gap-2">
                    <PlatformBadge platform={v.platform} />
                    <span className="text-sm font-medium">{platforms[v.platform].name}</span>
                    <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${statusCopy[v.status].className}`}>{statusCopy[v.status].label}</span>
                  </div>
                  {v.issues.length > 0 && (
                    <ul className="mt-1 space-y-0.5 pl-9 text-xs text-ink-soft">
                      {v.issues.map((i) => (
                        <li key={i.code}>{i.message}</li>
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
