import assert from "node:assert/strict";
import { hasVerifiedWahaIdentity, normalizeWahaIdentity } from "./waha-identity";

assert.equal(normalizeWahaIdentity("254712345678@c.us"), "254712345678");
assert.equal(normalizeWahaIdentity("254712345678:3@s.whatsapp.net"), "254712345678");
assert.equal(normalizeWahaIdentity("254712345678"), "254712345678");
assert.equal(normalizeWahaIdentity("254712345678@lid"), null);
assert.equal(normalizeWahaIdentity("254712345678@example.com"), null);
assert.equal(normalizeWahaIdentity("not-a-phone"), null);
assert.equal(hasVerifiedWahaIdentity({ status: "WORKING", accountId: "254712345678@c.us", activeIdentity: "254712345678" }), true);
assert.equal(hasVerifiedWahaIdentity({ status: "WORKING", accountId: "254712345678@c.us", activeIdentity: null }), false);
assert.equal(hasVerifiedWahaIdentity({ status: "STOPPED", accountId: "254712345678@c.us", activeIdentity: "254712345678" }), false);
console.log("PASS WhatsApp identity canonicalization and verified-session guard");
