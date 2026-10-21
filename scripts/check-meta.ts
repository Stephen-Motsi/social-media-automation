// Checks the Meta settings in .env against Meta itself. Usage: npm run meta:check
import { graphRequest, GraphApiError } from "@/lib/meta/graph";
import { getWhatsAppNumber, metaConfigured, redirectUri } from "@/lib/meta/oauth";

const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const bad = (msg: string) => console.log(`  ✗ ${msg}`);
const errText = (e: unknown) => (e instanceof GraphApiError ? e.message : e instanceof Error ? e.message : String(e));

async function main() {
  let failures = 0;

  console.log("Facebook & Instagram app");
  if (!metaConfigured()) {
    bad("META_APP_ID and/or META_APP_SECRET are empty in .env");
    failures++;
  } else {
    try {
      // An app token is only issued when the ID and secret match.
      const { access_token } = await graphRequest<{ access_token: string }>("oauth/access_token", null, {
        query: {
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          grant_type: "client_credentials",
        },
      });
      ok("App ID and secret are valid");
      const app = await graphRequest<{ name: string }>(process.env.META_APP_ID!, access_token, { query: { fields: "name" } });
      ok(`App name: ${app.name}`);
      try {
        const extra = await graphRequest<{ app_domains?: string[]; privacy_policy_url?: string }>(
          process.env.META_APP_ID!,
          access_token,
          { query: { fields: "app_domains,privacy_policy_url" } },
        );
        const domain = new URL(redirectUri()).hostname;
        if (extra.app_domains?.includes(domain)) ok(`App domain includes ${domain}`);
        else bad(`App domains don't include ${domain} (App settings → Basic → App domains)`);
        if (extra.privacy_policy_url) ok(`Privacy policy URL: ${extra.privacy_policy_url}`);
        else console.log("  • No privacy policy URL yet (needed before going Live)");
      } catch {
        console.log("  • Couldn't read app domain settings; check them in the dashboard");
      }
      console.log(`  • Make sure this is a Valid OAuth Redirect URI: ${redirectUri()}`);
    } catch (e) {
      bad(`Meta rejected the app ID/secret: ${errText(e)}`);
      failures++;
    }
  }

  console.log("WhatsApp");
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const waToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !waToken) {
    console.log("  • WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN not set (optional; you can enter them on the Accounts page)");
  } else {
    try {
      const n = await getWhatsAppNumber(phoneId, waToken);
      ok(`Number: ${n.verified_name} (${n.display_phone_number})${n.quality_rating ? `, quality ${n.quality_rating}` : ""}`);
    } catch (e) {
      bad(`Meta rejected the WhatsApp details: ${errText(e)}`);
      failures++;
    }
  }

  process.exit(failures ? 1 : 0);
}

main();
