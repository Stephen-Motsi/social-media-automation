// Phone and template-text checks. Run with `npm test`. Pure: no network or database needed.
import { normalizeLocation, normalizePhone, templateText } from "@/lib/audience";

let fails = 0;
function expect(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
}

expect("Kenyan 07… number", normalizePhone("0712 345 678"), "254712345678");
expect("Kenyan 01… number", normalizePhone("0110-123-456"), "254110123456");
expect("+254 with spaces", normalizePhone("+254 712 345678"), "254712345678");
expect("9 digits starting with 7", normalizePhone("712345678"), "254712345678");
expect("00 international prefix", normalizePhone("00447911123456"), "447911123456");
expect("other country with +", normalizePhone("+1 415 555 0100"), "14155550100");
expect("too short", normalizePhone("12345"), null);
expect("letters only", normalizePhone("call me"), null);
expect("template text: no new lines or runs of spaces", templateText("Fresh mangoes\n\nToday     only\t#deal"), "Fresh mangoes Today only #deal");
expect("template text: empty becomes a space", templateText("   "), " ");

expect("town tidy-up", normalizeLocation("  nairobi   west "), "Nairobi West");
expect("town with hyphen", normalizeLocation("homa-bay"), "Homa-Bay");
expect("empty town", normalizeLocation("   "), null);

process.exit(fails ? 1 : 0);
