import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchGoogleIdentity, identityFromClaims } from "../js/core/google-id.js";

function userinfo(overrides = {}) {
  return {
    sub: "1",
    email: "Rishab@Karunya.edu.in",
    email_verified: true,
    hd: "karunya.edu.in",
    name: "Rishab Haldar",
    ...overrides,
  };
}

test("identity comes from Google's userinfo and is limited to the college domain", async () => {
  const options = { domain: "karunya.edu.in" };
  assert.deepEqual(identityFromClaims(userinfo(), options), { name: "Rishab Haldar", email: "rishab@karunya.edu.in" });
  assert.equal(identityFromClaims(userinfo({ name: "Ünïcødé 名前" }), options).name, "Ünïcødé 名前");
  assert.match(identityFromClaims(userinfo({ hd: undefined, email: "x@gmail.com" }), options).error, /karunya\.edu\.in account/);
  assert.match(identityFromClaims(userinfo({ email_verified: false }), options).error, /not verified/);

  let seen = null;
  const ok = await fetchGoogleIdentity("tok-123", {
    domain: "karunya.edu.in",
    fetchImpl: async (url, init) => {
      seen = { url, auth: init.headers.Authorization };
      return { ok: true, json: async () => userinfo() };
    },
  });
  assert.deepEqual(ok, { name: "Rishab Haldar", email: "rishab@karunya.edu.in" });
  assert.equal(seen.url, "https://openidconnect.googleapis.com/v1/userinfo");
  assert.equal(seen.auth, "Bearer tok-123");
  const refused = await fetchGoogleIdentity("bad", { fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
  assert.match(refused.error, /could not be confirmed/);
  const offline = await fetchGoogleIdentity("t", { fetchImpl: async () => { throw new TypeError("offline"); } });
  assert.match(offline.error, /Could not reach Google/);
});
