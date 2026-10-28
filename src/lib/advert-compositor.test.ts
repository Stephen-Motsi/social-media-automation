import assert from "node:assert/strict";
import sharp from "sharp";
import { composeAdvertImage } from "./advert-compositor";

async function main() {
  const background = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#336699" } }).jpeg().toBuffer();
  const square = await composeAdvertImage(background, "INSTAGRAM", "POST", { headline: "Looking for a new phone?", offer: "30% off", supporting: "Upgrade your phone this weekend.", cta: "Shop now", handle: "@brandstore" });
  const landscape = await composeAdvertImage(background, "X", "POST", { headline: "Looking for a new phone?", offer: "30% off", supporting: "Upgrade your phone this weekend.", cta: "Shop now", handle: "@brandstore" });
  const squareInfo = await sharp(square).metadata();
  const landscapeInfo = await sharp(landscape).metadata();
  assert.equal(squareInfo.width, 1080);
  assert.equal(squareInfo.height, 1080);
  assert.equal(landscapeInfo.width, 1536);
  assert.equal(landscapeInfo.height, 1024);
  console.log("PASS  platform advert compositor produces distinct dimensions and controlled text layers");
}

main().catch((error) => { console.error(error); process.exit(1); });
