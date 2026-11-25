"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Platform, PostFormat } from "@prisma/client";
import { PlatformBadge, platforms as platformLabels } from "@/components/platforms";
import { advertImagePrompt, platformImagePrompt } from "@/lib/advert-prompt";
import type { AdvertImage, ImageResult } from "@/lib/advert-images";
import { formatSupport, platformOrder, type PlatformVerdict } from "@/lib/policy/rules";
import type { UserDraftInput } from "@/lib/user-drafts";
import { generateImageAction, refineImageAction, saveDraftAction } from "./actions";

const field = "w-full rounded-xl border border-line bg-white/50 px-3 py-2 dark:bg-white/5";

export function UserStudio({ draft, assets: initialAssets }: { draft: UserDraftInput | null; assets: AdvertImage[] }) {
  const router = useRouter();
  const [id, setId] = useState(draft?.id);
  const [title, setTitle] = useState(draft?.title ?? "");
  const [about, setAbout] = useState(draft?.about ?? "");
  const [caption, setCaption] = useState(draft?.caption ?? "");
  const [selected, setSelected] = useState<Platform[]>(draft?.platforms ?? []);
  const [media, setMedia] = useState<Partial<Record<Platform, string>>>(Object.fromEntries((draft?.media ?? []).map((item) => [item.platform, item.id])));
  const [assets, setAssets] = useState(initialAssets);
  const [platform, setPlatform] = useState<Platform>(draft?.platforms[0] ?? "FACEBOOK");
  const [format, setFormat] = useState<PostFormat>("POST");
  const [prompt, setPrompt] = useState("");
  const [instruction, setInstruction] = useState("");
  const [headline, setHeadline] = useState("");
  const [offer, setOffer] = useState("");
  const [supporting, setSupporting] = useState("");
  const [cta, setCta] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [verdicts, setVerdicts] = useState<PlatformVerdict[]>([]);
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const run = (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    start(async () => {
      try {
        await operation();
      } catch {
        setError("The operation failed. Check your connection and try again.");
      } finally {
        setBusy(false);
      }
    });
  };
  const applyImage = (result: ImageResult) => {
    if (!result.ok) {
      setError([result.error, ...(result.issues ?? []).map((issue) => issue.message)].join(" "));
      return;
    }
    setVerdicts([result.verdict]);
    if (result.media.blocked) {
      setError("The image could not be used because it failed content checks.");
      return;
    }
    setAssets((current) => [result.media, ...current.filter((asset) => asset.id !== result.media.id)]);
    setMedia((current) => ({ ...current, [platform]: result.media.id }));
    setMessage("Image ready and selected for this platform.");
  };
  const basePrompt = prompt.trim() || advertImagePrompt({ title, about, caption, topics: [] });
  const imageInput = {
    platform,
    format,
    prompt: platformImagePrompt({ title, about, caption, topics: [] }, platform, format, basePrompt),
    caption,
  };

  const generate = () => run(async () => {
    if (!selected.includes(platform)) return setError("Select this platform for the draft first.");
    const copy = [headline, offer, supporting, cta].some((value) => value.trim())
      ? { headline, offer, supporting, cta }
      : undefined;
    applyImage(await generateImageAction({ ...imageInput, copy }));
  });
  const refine = () => run(async () => {
    if (!selected.includes(platform) || !media[platform]) return setError("Select an image for this platform first.");
    applyImage(await refineImageAction({ ...imageInput, prompt: instruction, mediaId: media[platform]! }));
  });
  const upload = () => run(async () => {
    if (!selected.includes(platform)) return setError("Select this platform for the draft first.");
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Choose an image to upload.");
    const body = new FormData();
    body.set("file", file);
    body.set("platform", platform);
    body.set("format", format);
    body.set("caption", caption);
    const response = await fetch("/api/uploads", { method: "POST", body });
    const result = await response.json() as ImageResult;
    if (!response.ok && result.ok) throw new Error("Upload failed.");
    applyImage(result);
    if (fileRef.current) fileRef.current.value = "";
  });
  const save = () => run(async () => {
    const result = await saveDraftAction({
      id, title, about, caption, platforms: selected,
      media: selected.flatMap((item) => media[item] ? [{ platform: item, id: media[item]! }] : []),
    });
    if (!result.ok) return setError(result.error);
    setId(result.postId);
    setVerdicts(result.verdicts);
    setMessage("Draft saved. Nothing has been published or scheduled.");
    router.replace(`/me/create?id=${encodeURIComponent(result.postId)}`, { scroll: false });
    router.refresh();
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="glass space-y-5 rounded-3xl p-6">
        <h2 className="text-lg font-semibold">Advert details</h2>
        <label className="block text-sm font-medium">Title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} className={`mt-1 ${field}`} /></label>
        <label className="block text-sm font-medium">Description<textarea value={about} onChange={(event) => setAbout(event.target.value)} maxLength={500} rows={2} className={`mt-1 ${field}`} /></label>
        <label className="block text-sm font-medium">Caption<textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={63206} rows={5} className={`mt-1 ${field}`} /></label>
        <fieldset>
          <legend className="text-sm font-medium">Platforms for this draft</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {platformOrder.map((item) => (
              <label key={item} className="flex items-center gap-2 rounded-full border border-line px-3 py-2 text-sm">
                <input type="checkbox" checked={selected.includes(item)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item] : current.filter((p) => p !== item))} />
                {platformLabels[item].name}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-soft">Removing a platform removes its image selection when you save; the image stays in your library. Platforms without their own selection use the draft&apos;s main image when available.</p>
        </fieldset>
        <button type="button" onClick={save} disabled={busy} className="blend-meta rounded-full px-5 py-2.5 font-medium text-white disabled:opacity-50">
          {busy ? "Working…" : "Save draft"}
        </button>
        {message && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {verdicts.length > 0 && (
          <div aria-live="polite">
            <h3 className="font-medium">Content and platform checks</h3>
            <p className="mt-1 text-xs text-ink-soft">Image checks use the chosen shape. Saved draft checks use post format; choosing a story shape does not schedule a story.</p>
            <ul className="mt-2 space-y-2 text-sm">
              {verdicts.map((verdict) => (
                <li key={verdict.platform}>
                  <span className="font-medium">{platformLabels[verdict.platform].name}: {verdict.status}</span>
                  {verdict.issues.map((issue) => <p key={issue.code} className="text-xs text-ink-soft">{issue.message}</p>)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="glass space-y-4 rounded-3xl p-6">
        <h2 className="text-lg font-semibold">Images</h2>
        <p className="text-sm text-ink-soft">Generate, refine, upload or select one of your images for each chosen platform.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Platform
            <select value={platform} onChange={(event) => { setPlatform(event.target.value as Platform); setFormat("POST"); }} className={`mt-1 ${field}`}>
              {platformOrder.map((item) => <option key={item} value={item}>{platformLabels[item].name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Image shape for
            <select value={format} onChange={(event) => setFormat(event.target.value as PostFormat)} className={`mt-1 ${field}`}>
              <option value="POST">Post</option>
              {formatSupport[platform].STORY.supported && <option value="STORY">Story</option>}
            </select>
          </label>
        </div>
        {!selected.includes(platform) && <p className="text-xs text-ink-soft">Choose {platformLabels[platform].name} above to attach an image.</p>}
        <label className="block text-sm font-medium">Image description
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the image, or leave blank to use the advert details" maxLength={700} rows={3} className={`mt-1 ${field}`} />
        </label>
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Optional text on the image</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label>Headline<input value={headline} onChange={(event) => setHeadline(event.target.value)} maxLength={90} className={`mt-1 ${field}`} /></label>
            <label>Offer<input value={offer} onChange={(event) => setOffer(event.target.value)} maxLength={40} className={`mt-1 ${field}`} /></label>
            <label>Supporting text<input value={supporting} onChange={(event) => setSupporting(event.target.value)} maxLength={180} className={`mt-1 ${field}`} /></label>
            <label>Call to action<input value={cta} onChange={(event) => setCta(event.target.value)} maxLength={40} className={`mt-1 ${field}`} /></label>
          </div>
        </details>
        <button type="button" onClick={generate} disabled={busy || !selected.includes(platform)} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-ink">Generate image</button>
        <div className="space-y-2 border-t border-line pt-4">
          <label className="block text-sm font-medium">Upload image<input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="mt-2 block w-full text-sm" /></label>
          <button type="button" onClick={upload} disabled={busy || !selected.includes(platform)} className="rounded-full border border-line px-4 py-2 text-sm disabled:opacity-50">Upload</button>
        </div>
        <div className="space-y-2 border-t border-line pt-4">
          <label className="block text-sm font-medium">Your images for {platformLabels[platform].name}
            <select value={media[platform] ?? ""} onChange={(event) => setMedia((current) => ({ ...current, [platform]: event.target.value || undefined }))} disabled={!selected.includes(platform)} className={`mt-1 ${field}`}>
              <option value="">No image selected</option>
              {assets.map((asset, index) => <option key={asset.id} value={asset.id}>Image {index + 1} · {asset.width} × {asset.height}</option>)}
            </select>
          </label>
          {media[platform] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/media/${media[platform]}`} alt={`Selected image for ${platformLabels[platform].name}`} className="max-h-64 rounded-xl object-contain" />
          )}
          <label className="block text-sm font-medium">Refinement instructions
            <input value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={1000} placeholder="Make the background brighter" className={`mt-1 ${field}`} />
          </label>
          <button type="button" onClick={refine} disabled={busy || !selected.includes(platform) || !media[platform]} className="rounded-full border border-line px-4 py-2 text-sm disabled:opacity-50">Refine selected image</button>
        </div>
        {selected.length > 0 && (
          <ul className="space-y-1 border-t border-line pt-4 text-sm">
            {selected.map((item) => <li key={item} className="flex items-center gap-2"><PlatformBadge platform={item} /> {platformLabels[item].name}: {media[item] ? "image selected" : "no image selected"}</li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
