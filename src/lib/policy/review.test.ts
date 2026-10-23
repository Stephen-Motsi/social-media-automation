// Policy rule checks. Run with `npm test`. Pure: no network or database needed.
// Results read F(acebook), I(nstagram), W(hatsApp), X, T(ikTok).
import { review, xWeightedLength } from "@/lib/policy/review";

const clean = { flagged: false, categories: {}, category_scores: {} };
const img = (w: number, h: number, mimeType = "image/jpeg", sizeBytes = 500_000) => ({
  mimeType,
  width: w,
  height: h,
  sizeBytes,
  data: new Uint8Array(),
});
let fails = 0;
function expect(name: string, got: string | string[], want: string | string[]) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${ok ? "" : `got ${got} want ${want}`}`);
}
const statuses = (v: ReturnType<typeof review>) => v.map((x) => `${x.platform[0]}:${x.status}`);
const codes = (v: ReturnType<typeof review>) => v.flatMap((x) => x.issues.map((i) => i.code));

// ---- Feed posts, all five platforms
expect("square jpeg + caption", statuses(review({ caption: "Hello", image: img(1024, 1024) }, clean)), ["F:pass", "I:pass", "W:warn", "X:pass", "T:pass"]);
expect("portrait 2:3 -> IG blocked", statuses(review({ caption: "Hi", image: img(1024, 1536) }, clean)), ["F:pass", "I:block", "W:warn", "X:pass", "T:pass"]);
expect("landscape 3:2 ok on IG", statuses(review({ caption: "Hi", image: img(1536, 1024) }, clean)), ["F:pass", "I:pass", "W:warn", "X:pass", "T:pass"]);
expect("png -> IG and TikTok blocked", statuses(review({ caption: "Hi", image: img(1024, 1024, "image/png") }, clean)), ["F:pass", "I:block", "W:warn", "X:pass", "T:block"]);
expect("9MB -> size limits (TikTok allows 20MB)", statuses(review({ caption: "Hi", image: img(1024, 1024, "image/jpeg", 9 * 1024 * 1024) }, clean)), ["F:block", "I:block", "W:block", "X:block", "T:pass"]);
expect("text only -> IG and TikTok need an image", statuses(review({ caption: "Hi" }, clean)), ["F:pass", "I:block", "W:pass", "X:pass", "T:block"]);
expect("image only -> WA needs text", statuses(review({ caption: "", image: img(1024, 1024) }, clean)), ["F:pass", "I:pass", "W:block", "X:pass", "T:pass"]);
expect("31 hashtags -> IG blocked", statuses(review({ caption: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" "), image: img(1024, 1024) }, clean)), ["F:pass", "I:block", "W:warn", "X:pass", "T:pass"]);
expect("2201 chars -> IG and X blocked", statuses(review({ caption: "a".repeat(2201), image: img(1024, 1024) }, clean)), ["F:pass", "I:block", "W:warn", "X:block", "T:pass"]);

// ---- X weighted length
expect("X: 280 plain chars ok", statuses(review({ caption: "a".repeat(280) }, clean, ["X"])), ["X:pass"]);
expect("X: 281 plain chars blocked", statuses(review({ caption: "a".repeat(281) }, clean, ["X"])), ["X:block"]);
expect("X: long link counts as 23", String(xWeightedLength("a".repeat(250) + " https://example.com/" + "p".repeat(100))), "274");
expect("X: emoji count as 2", String(xWeightedLength("🥭🥭")), "4");

// ---- Content and restricted topics
expect("'get' is not 'bet' (no false positive)", statuses(review({ caption: "Get yours today", image: img(1024, 1024) }, clean)), ["F:pass", "I:pass", "W:warn", "X:pass", "T:pass"]);
expect("betting -> FB/IG/X warn, WA/TikTok block", statuses(review({ caption: "Big betting odds tonight", image: img(1024, 1024) }, clean)), ["F:warn", "I:warn", "W:block", "X:warn", "T:block"]);
const sexual = { flagged: true, categories: { sexual: true }, category_scores: { sexual: 0.9 } };
expect("sexual flagged -> blocked everywhere", statuses(review({ caption: "x", image: img(1024, 1024) }, sexual)), ["F:block", "I:block", "W:block", "X:block", "T:block"]);
const illicit = { flagged: true, categories: { illicit: true }, category_scores: { illicit: 0.6 } };
expect("illicit -> FB/IG/X warn, WA/TikTok block", statuses(review({ caption: "x", image: img(1024, 1024) }, illicit)), ["F:warn", "I:warn", "W:block", "X:warn", "T:block"]);
const border = { flagged: false, categories: {}, category_scores: { "violence/graphic": 0.3 } };
expect("borderline graphic violence -> warn", statuses(review({ caption: "x", image: img(1024, 1024) }, border)), ["F:warn", "I:warn", "W:warn", "X:warn", "T:warn"]);
expect("moderation unavailable -> fail closed", statuses(review({ caption: "x", image: img(1024, 1024) }, null)), ["F:block", "I:block", "W:block", "X:block", "T:block"]);

// ---- Stories and status
const story = { FACEBOOK: "STORY", INSTAGRAM: "STORY", WHATSAPP: "STORY", X: "STORY", TIKTOK: "STORY" } as const;
const all = ["FACEBOOK", "INSTAGRAM", "WHATSAPP", "X", "TIKTOK"] as const;
expect("9:16 story, no caption -> FB/IG pass; WA status, X, TikTok unsupported", statuses(review({ caption: "", image: img(1080, 1920) }, clean, [...all], undefined, story)), ["F:pass", "I:pass", "W:block", "X:block", "T:block"]);
expect("story with caption -> warn (captions hidden)", codes(review({ caption: "Hi", image: img(1080, 1920) }, clean, ["INSTAGRAM"], undefined, story)), ["story.caption"]);
expect("square story -> warn (cropped)", codes(review({ caption: "", image: img(1024, 1024) }, clean, ["FACEBOOK"], undefined, story)), ["story.aspect"]);
expect("story without image -> blocked", statuses(review({ caption: "Hi" }, clean, ["INSTAGRAM"], undefined, story)), ["I:block"]);
expect("png story -> IG blocked, FB ok", statuses(review({ caption: "", image: img(1080, 1920, "image/png") }, clean, ["FACEBOOK", "INSTAGRAM"], undefined, story)), ["F:pass", "I:block"]);
expect("WhatsApp status reason", review({ caption: "Hi" }, clean, ["WHATSAPP"], undefined, story)[0].issues[0].message, "WhatsApp's Business API can't post Status updates. It can only send messages.");

process.exit(fails ? 1 : 0);
