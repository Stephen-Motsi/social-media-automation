// Policy rule checks. Run with `npm test`. Pure: no network or database needed.
import { review } from "@/lib/policy/review";

const clean = { flagged: false, categories: {}, category_scores: {} };
const img = (w: number, h: number, mimeType = "image/jpeg", sizeBytes = 500_000) => ({ mimeType, width: w, height: h, sizeBytes, data: new Uint8Array() });
let fails = 0;
function expect(name: string, got: string[], want: string[]) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${ok ? "" : `got ${got} want ${want}`}`);
}
const statuses = (v: ReturnType<typeof review>) => v.map((x) => `${x.platform[0]}:${x.status}`);

expect("square jpeg + caption -> FB/IG pass, WA warn (image dropped)", statuses(review({ caption: "Hello", image: img(1024, 1024) }, clean)), ["F:pass", "I:pass", "W:warn"]);
expect("portrait 2:3 -> IG blocked", statuses(review({ caption: "Hi", image: img(1024, 1536) }, clean)), ["F:pass", "I:block", "W:warn"]);
expect("landscape 3:2 ok on IG", statuses(review({ caption: "Hi", image: img(1536, 1024) }, clean)), ["F:pass", "I:pass", "W:warn"]);
expect("png -> IG blocked (JPEG only)", statuses(review({ caption: "Hi", image: img(1024, 1024, "image/png") }, clean)), ["F:pass", "I:block", "W:warn"]);
expect("9MB -> all size limits", statuses(review({ caption: "Hi", image: img(1024, 1024, "image/jpeg", 9 * 1024 * 1024) }, clean)), ["F:block", "I:block", "W:block"]);
expect("text only -> IG needs image", statuses(review({ caption: "Hi" }, clean)), ["F:pass", "I:block", "W:pass"]);
expect("image only -> WA needs text", statuses(review({ caption: "", image: img(1024, 1024) }, clean)), ["F:pass", "I:pass", "W:block"]);
expect("31 hashtags -> IG blocked", statuses(review({ caption: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" "), image: img(1024, 1024) }, clean)), ["F:pass", "I:block", "W:warn"]);
expect("2201 chars -> IG blocked", statuses(review({ caption: "a".repeat(2201), image: img(1024, 1024) }, clean)), ["F:pass", "I:block", "W:warn"]);
expect("betting -> FB/IG warn, WA block", statuses(review({ caption: "Big betting odds tonight", image: img(1024, 1024) }, clean)), ["F:warn", "I:warn", "W:block"]);
expect("'get' is not 'bet' (no false positive)", statuses(review({ caption: "Get yours today", image: img(1024, 1024) }, clean)), ["F:pass", "I:pass", "W:warn"]);
const sexual = { flagged: true, categories: { sexual: true }, category_scores: { sexual: 0.9 } };
expect("sexual flagged -> blocked everywhere", statuses(review({ caption: "x", image: img(1024, 1024) }, sexual)), ["F:block", "I:block", "W:block"]);
const illicit = { flagged: true, categories: { illicit: true }, category_scores: { illicit: 0.6 } };
expect("illicit -> FB/IG warn, WA block", statuses(review({ caption: "x" , image: img(1024, 1024)}, illicit)), ["F:warn", "I:warn", "W:block"]);
const border = { flagged: false, categories: {}, category_scores: { "violence/graphic": 0.3 } };
expect("borderline graphic violence -> warn", statuses(review({ caption: "x", image: img(1024, 1024) }, border)), ["F:warn", "I:warn", "W:warn"]);
expect("moderation unavailable -> fail closed", statuses(review({ caption: "x", image: img(1024, 1024) }, null)), ["F:block", "I:block", "W:block"]);

process.exit(fails ? 1 : 0);
