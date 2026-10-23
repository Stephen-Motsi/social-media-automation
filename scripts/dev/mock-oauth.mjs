// Stand-in OAuth provider (like Google/Facebook) for local testing only.
// Run: node scripts/dev/mock-oauth.mjs, then set MOCK_OAUTH_URL="http://localhost:4040" in .env (never in production).
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
const PEOPLE = {
  amina: { sub: "mock-amina", name: "Amina Otieno", email: "amina@example.test", email_verified: true },
  brian: { sub: "mock-brian", name: "Brian Kip", email: "brian@example.test", email_verified: true },
  // Same email as the staff account: must NOT be able to take it over
  clash: { sub: "mock-clash", name: "Not The Admin", email: "admin@example.com", email_verified: true },
};
const codes = new Map(); // code -> { person, challenge, redirect }
const tokens = new Map(); // access token -> person
const log = [];
createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost:4040");
  let body = ""; for await (const c of req) body += c;
  log.push({ m: req.method, p: u.pathname });
  if (u.pathname === "/__log") return res.end(JSON.stringify(log));
  if (u.pathname === "/authorize") {
    const q = u.searchParams;
    if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge") || !q.get("state")) { res.writeHead(400); return res.end("PKCE and state required"); }
    // Consent screen: "Social Automation wants to access your name and email"
    const choose = (id) => { const back = new URL(q.get("redirect_uri")); const code = randomBytes(12).toString("hex"); codes.set(code, { person: PEOPLE[id], challenge: q.get("code_challenge"), redirect: q.get("redirect_uri") }); back.searchParams.set("code", code); back.searchParams.set("state", q.get("state")); return back.toString(); };
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(`<h1>Test login</h1><p>Social Automation wants to access your name, email and profile picture.</p>${Object.keys(PEOPLE).map((id) => `<p><a id="allow-${id}" href="${choose(id)}">Allow as ${PEOPLE[id].name} (${PEOPLE[id].email})</a></p>`).join("")}<p><a id="deny" href="${q.get("redirect_uri")}?error=access_denied&state=${q.get("state")}">Cancel</a></p>`);
  }
  if (u.pathname === "/token") {
    const f = new URLSearchParams(body);
    const entry = codes.get(f.get("code"));
    const verifier = f.get("code_verifier") ?? "";
    const ok = entry && createHash("sha256").update(verifier).digest("base64url") === entry.challenge && f.get("redirect_uri") === entry.redirect;
    log.at(-1).detail = { pkce_ok: Boolean(ok) };
    if (!ok) { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "invalid_grant" })); }
    codes.delete(f.get("code"));
    const at = randomBytes(16).toString("hex"); tokens.set(at, entry.person);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ access_token: at, token_type: "bearer", expires_in: 3600, scope: "openid email profile" }));
  }
  if (u.pathname === "/userinfo") {
    const p = tokens.get((req.headers.authorization ?? "").replace(/^Bearer /i, ""));
    if (!p) { res.writeHead(401); return res.end(); }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(p));
  }
  res.writeHead(404); res.end();
}).listen(4040, () => console.log("mock oauth on 4040"));
