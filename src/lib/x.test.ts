// OAuth 1.0a signing for X, checked against X's published example. Run with `npm test`.
// https://developer.x.com/en/docs/authentication/oauth-1-0a/creating-a-signature
import { xAuthHeader, xOAuth1Token } from "@/lib/x";

let fails = 0;
function expect(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
}

process.env.X_API_KEY = "xvz1evFS4wEEPTGEFPHBog";
process.env.X_API_SECRET = "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw";
const token = xOAuth1Token("370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE");
// The example's parameters (sent here as query parameters, which are signed the same way)
const url =
  "https://api.twitter.com/1.1/statuses/update.json?include_entities=true&status=" +
  encodeURIComponent("Hello Ladies + Gentlemen, a signed OAuth request!");
const header = xAuthHeader("POST", url, token, { nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", timestamp: "1318622958" });
const sig = decodeURIComponent(/oauth_signature="([^"]+)"/.exec(header)?.[1] ?? "");
expect("signature matches X's example", sig, "hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
expect("OAuth header", header.startsWith("OAuth "), true);
expect("bearer tokens pass through", xAuthHeader("GET", "https://api.x.com/2/users/me", "abc"), "Bearer abc");

process.exit(fails ? 1 : 0);
