import assert from "node:assert/strict";
import { test } from "node:test";
import { PBKDF2_ITERATIONS, hashPin, verifyPin } from "../js/core/crypto.js";

test("PBKDF2 iteration floor is at least 300000", () => {
  assert.ok(PBKDF2_ITERATIONS >= 300000);
});

test("PIN hash compares without storing the PIN", async () => {
  const stored = await hashPin("lab-pin", { iterations: 1000 });
  assert.equal(await verifyPin("lab-pin", stored), true);
  assert.equal(await verifyPin("other-pin", stored), false);
  assert.equal(JSON.stringify(stored).includes("lab-pin"), false);
});
