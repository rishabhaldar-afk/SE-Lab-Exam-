import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidReg, normalizeReg } from "../js/core/assign.js";

test("normalizeReg trims, uppercases, and removes spaces", () => {
  assert.equal(normalizeReg("  ab 12 cd "), "AB12CD");
});

test("register pattern accepts a typical number", () => {
  assert.equal(isValidReg(normalizeReg("22bce1234"), "^[A-Z0-9][A-Z0-9/-]{2,31}$"), true);
  assert.equal(isValidReg("A", "^[A-Z0-9][A-Z0-9/-]{2,31}$"), false);
});
