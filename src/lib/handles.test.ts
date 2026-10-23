// Handle normalisation and matching checks. Run with `npm test`. Pure: no network or database needed.
import { handleMatches, normalizeHandle, validateHandle } from "@/lib/handles";

let fails = 0;
function expect(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
}

expect("IG @handle", normalizeHandle("INSTAGRAM", " @MangoMarket.KE "), "mangomarket.ke");
expect("IG profile link", normalizeHandle("INSTAGRAM", "https://www.instagram.com/mangomarket.ke/?hl=en"), "mangomarket.ke");
expect("X twitter.com link", normalizeHandle("X", "twitter.com/MangoMarket"), "mangomarket");
expect("TikTok link with @", normalizeHandle("TIKTOK", "https://www.tiktok.com/@mangomarket?lang=en"), "mangomarket");
expect("FB m. link", normalizeHandle("FACEBOOK", "https://m.facebook.com/MangoMarketKE/"), "mangomarketke");
expect("WA spaced number", normalizeHandle("WHATSAPP", "+254 700-000 000"), "254700000000");

expect("validate: bad IG handle", validateHandle("INSTAGRAM", "mango market!") !== null, true);
expect("validate: short WA number", validateHandle("WHATSAPP", "12345") !== null, true);
expect("validate: good X handle", validateHandle("X", "@mangomarket"), null);

const acct = (handle: string | null, displayName = "Mango Market Ltd", externalId = "1111") => ({ handle, displayName, externalId });
expect("match IG handle", handleMatches("INSTAGRAM", "@mangomarket.ke", acct("mangomarket.ke")), true);
expect("mismatch IG handle", handleMatches("INSTAGRAM", "@someoneelse", acct("mangomarket.ke")), false);
expect("FB match by Page name when no username", handleMatches("FACEBOOK", "Mango Market Ltd", acct(null)), true);
expect("FB match by Page ID", handleMatches("FACEBOOK", "1111", acct(null)), true);
expect("FB match by username link", handleMatches("FACEBOOK", "facebook.com/mangomarketke", acct("mangomarketke")), true);
expect("WA match by digits", handleMatches("WHATSAPP", "+254 700 000 000", acct("254700000000")), true);
expect("X mismatch", handleMatches("X", "@mangomarket", acct("mango_market")), false);
expect("no expected handle matches anything", handleMatches("X", "", acct("anyone")), true);

process.exit(fails ? 1 : 0);
