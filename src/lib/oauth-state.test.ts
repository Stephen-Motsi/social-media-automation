import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { boundOAuthState, stateMatches } from "./oauth-state";

const state = "random-state";
const viewer = { id: "alice", sessionId: "session-a", role: "USER" as const };
const cookie = boundOAuthState(state, viewer);
function request(value: string, stored = cookie) {
  return new NextRequest(`http://localhost/api/x/callback?state=${encodeURIComponent(value)}`, { headers: { cookie: `x_state=${stored}` } });
}

assert.equal(stateMatches(request(state), "x_state", viewer), true);
assert.equal(stateMatches(request(state), "x_state", { ...viewer, id: "bob" }), false);
assert.equal(stateMatches(request(state), "x_state", { ...viewer, sessionId: "session-b" }), false);
assert.equal(stateMatches(request(state), "x_state", { ...viewer, role: "ADMIN" }), false);
assert.equal(stateMatches(request("different"), "x_state", viewer), false);
assert.equal(stateMatches(request(state, ""), "x_state", viewer), false);
assert.equal(stateMatches(request("é"), "x_state", viewer), false);
console.log("PASS OAuth state is bound to the initiating user, session and role");
