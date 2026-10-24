// Advert photo prompt checks. Run with `npm test`. Pure.
import { advertImagePrompt, platformImagePrompt, platformShape, shapeFor } from "@/lib/advert-prompt";

let fails = 0;
function expect(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
}
const p = advertImagePrompt({ title: "Weekend phone sale", about: "20% off smartphones   at Westlands", caption: "", topics: ["Electronics"] });
expect("uses title and about", p.includes("Weekend phone sale. 20% off smartphones at Westlands."), true);
expect("no double full stops", advertImagePrompt({ title: "Mangoes.", about: "Delivered this week.", caption: "", topics: [] }).includes(".."), false);
expect("includes topics", p.includes("Category: Electronics."), true);
expect("asks for no text in the image", p.includes("Do not include any words"), true);
expect("falls back to caption", advertImagePrompt({ title: "", about: "", caption: "Fresh mangoes", topics: [] }).includes("Fresh mangoes"), true);
expect("empty details -> empty prompt", advertImagePrompt({ title: " ", about: "", caption: "", topics: [] }), "");
expect("square for mixed posts", shapeFor([{ platform: "INSTAGRAM", format: "POST" }, { platform: "X", format: "POST" }]), "square");
expect("portrait when every target is a story", shapeFor([{ platform: "INSTAGRAM", format: "STORY" }, { platform: "FACEBOOK", format: "STORY" }]), "portrait");
expect("square when nothing is targeted", shapeFor([]), "square");
const d = { title: "Weekend phone sale", about: "20% off smartphones", caption: "", topics: [] };
expect("X: wide", platformShape("X", "POST"), "landscape");
expect("TikTok: tall", platformShape("TIKTOK", "POST"), "portrait");
expect("Instagram story: tall", platformShape("INSTAGRAM", "STORY"), "portrait");
expect("WhatsApp: square", platformShape("WHATSAPP", "POST"), "square");
expect("prompt keeps the details", platformImagePrompt(d, "INSTAGRAM", "POST").startsWith("Professional advertising photo for: Weekend phone sale. 20% off smartphones."), true);
expect("prompt adds the platform style", platformImagePrompt(d, "TIKTOK", "POST").includes("Styled for TikTok"), true);
expect("prompt adds the shape", platformImagePrompt(d, "X", "POST").includes("Wide 3:2"), true);
expect("story prompt says story", platformImagePrompt(d, "FACEBOOK", "STORY").includes("(a Facebook story)"), true);
expect("platform prompts differ", platformImagePrompt(d, "X", "POST") !== platformImagePrompt(d, "WHATSAPP", "POST"), true);
expect("still no text in the image", platformImagePrompt(d, "X", "POST").includes("Do not include any words"), true);
expect("empty details -> empty prompt", platformImagePrompt({ title: "", about: "", caption: "", topics: [] }, "X", "POST"), "");
process.exit(fails ? 1 : 0);
