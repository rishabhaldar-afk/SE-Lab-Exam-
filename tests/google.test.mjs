import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeIdToken, identityFromClaims } from "../js/core/google-id.js";

const CLIENT = "123-abc.apps.googleusercontent.com";

function fakeToken(claims) {
  const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64url({ alg: "RS256" })}.${b64url(claims)}.signature`;
}

function claims(overrides = {}) {
  return {
    aud: CLIENT,
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: "Rishab@Karunya.edu.in",
    email_verified: true,
    hd: "karunya.edu.in",
    name: "Rishab Haldar",
    ...overrides,
  };
}

test("the page reads name and email from a Google token and checks domain, audience, and expiry", () => {
  const options = { clientId: CLIENT, domain: "karunya.edu.in" };
  assert.deepEqual(identityFromClaims(decodeIdToken(fakeToken(claims())), options), { name: "Rishab Haldar", email: "rishab@karunya.edu.in" });
  assert.equal(identityFromClaims(claims({ name: "Ünïcødé 名前" }), options).name, "Ünïcødé 名前");
  assert.match(identityFromClaims(claims({ hd: undefined, email: "x@gmail.com" }), options).error, /karunya\.edu\.in account/);
  assert.match(identityFromClaims(claims({ aud: "other" }), options).error, /not for this exam/);
  assert.match(identityFromClaims(claims({ exp: 1 }), options).error, /expired/);
  assert.match(identityFromClaims(claims({ email_verified: false }), options).error, /not verified/);
  assert.throws(() => decodeIdToken("not-a-token"));
});
