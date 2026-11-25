import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { boundOAuthState, channelsUrl, connectionScope, validatedOAuthScope } from "./oauth-state";

const state = "random-state";
const viewer = { id: "alice", sessionId: "session-a", role: "USER" as const };
const cookie = boundOAuthState(state, viewer, "personal");
function request(value: string, stored = cookie) {
  return new NextRequest(`http://localhost/api/x/callback?state=${encodeURIComponent(value)}`, { headers: { cookie: `x_state=${stored}` } });
}

assert.equal(validatedOAuthScope(request(state), "x_state", viewer), "personal");
assert.equal(validatedOAuthScope(request(state), "x_state", { ...viewer, id: "bob" }), null);
assert.equal(validatedOAuthScope(request(state), "x_state", { ...viewer, sessionId: "session-b" }), null);
assert.equal(validatedOAuthScope(request(state), "x_state", { ...viewer, role: "ADMIN" }), null);
assert.equal(validatedOAuthScope(request("different"), "x_state", viewer), null);
assert.equal(validatedOAuthScope(request(state, ""), "x_state", viewer), null);
assert.equal(validatedOAuthScope(request("é"), "x_state", viewer), null);
assert.equal(connectionScope(viewer, "shared"), null);
assert.equal(connectionScope(viewer, null), "personal");
for (const role of ["ADMIN", "SUPER_ADMIN"] as const) {
  const staff = { ...viewer, role };
  assert.equal(connectionScope(staff, null), "shared");
  assert.equal(connectionScope(staff, "personal"), "personal");
  const personal = boundOAuthState(state, staff, "personal");
  const shared = boundOAuthState(state, staff, "shared");
  assert.equal(validatedOAuthScope(request(state, personal), "x_state", staff), "personal");
  assert.equal(validatedOAuthScope(request(state, shared), "x_state", staff), "shared");
  assert.equal(validatedOAuthScope(request(state, personal.replace(".personal.", ".shared.")), "x_state", staff), null);
  assert.equal(channelsUrl(request(state), {}, staff, "personal").pathname, "/me/accounts");
  assert.equal(channelsUrl(request(state), {}, staff, "shared").pathname, "/channels");
}
assert.equal(validatedOAuthScope(request(state, boundOAuthState(state, viewer, "shared")), "x_state", viewer), null);
console.log("PASS OAuth user/session/role and personal/shared ownership binding");
