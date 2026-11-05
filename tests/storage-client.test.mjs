import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyClient } from "../js/core/client-check.js";
import { minorKey } from "../js/ui/lockdown-ui.js";
import { isValidEmail, parseQuestionNumber, validateGate } from "../js/ui/gate.js";
import { drawioUrl } from "../js/ui/uml-tab.js";
import { createMemoryBackend, createStore, freshSession, parseSession, remainingMs } from "../js/core/storage.js";

test("sessions round-trip and unknown versions are refused", () => {
  const backend = createMemoryBackend();
  const store = createStore(backend);
  const session = freshSession({ name: "Ada", reg: "22BCE1", questionId: 4, now: 10 });
  store.save(session.reg, session);
  assert.equal(store.load("22BCE1").questionId, 4);
  assert.throws(() => parseSession(JSON.stringify({ v: 99, session })));
  store.saveForces({ "22BCE1": 7 });
  assert.equal(store.loadForces()["22BCE1"], 7);
});

test("close time can end the exam before the duration", () => {
  const left = remainingMs(0, 1_000, 120, 500, 0);
  assert.equal(left, 0);
});

test("client classification", () => {
  assert.equal(classifyClient({ userAgent: "Mozilla/5.0 Chrome/120.0.0.0" }).ok, true);
  assert.equal(classifyClient({ userAgent: "Mozilla/5.0 Edg/120.0.0.0" }).ok, true);
  const firefox = classifyClient({ userAgent: "Mozilla/5.0 Firefox/120.0" });
  assert.equal(firefox.ok, true);
  assert.equal(firefox.keyboardLockLikely, false);
  assert.equal(classifyClient({ userAgent: "Mozilla/5.0 Safari/17.0" }).ok, false);
  assert.equal(classifyClient({ userAgent: "Mozilla/5.0 Chrome/120 Mobile" }).ok, false);
  assert.equal(classifyClient({ userAgent: "Mozilla/5.0 Chrome/120", pointerCoarse: true, pointerFine: false }).ok, false);
  assert.equal(classifyClient({ userAgent: "SEB/3.0" }).seb, true);
});

test("minor keys and the draw.io embed URL", () => {
  assert.equal(minorKey({ key: "F12" }), "DEVTOOLS_KEY");
  assert.equal(minorKey({ key: "I", ctrlKey: true, shiftKey: true }), "DEVTOOLS_KEY");
  assert.equal(minorKey({ key: "i", ctrlKey: true, altKey: true, shiftKey: true }), "INVIGILATOR_CHORD");
  assert.equal(minorKey({ key: "r", ctrlKey: true }), "RELOAD_KEY");
  assert.equal(minorKey({ key: "p", ctrlKey: true }), "PRINT_KEY");
  const url = new URL(drawioUrl("https://embed.diagrams.net"));
  assert.equal(url.origin, "https://embed.diagrams.net");
  assert.equal(url.searchParams.get("embed"), "1");
  assert.equal(url.searchParams.get("proto"), "json");
  assert.equal(url.searchParams.get("configure"), "1");
  assert.equal(url.searchParams.get("noSaveBtn"), "1");
  assert.equal(url.searchParams.get("noExitBtn"), "1");
  assert.equal(url.searchParams.get("saveAndExit"), "0");
});

test("the gate requires a valid email and a question number from the paper", () => {
  const config = { REGNO_PATTERN: "^[A-Z0-9][A-Z0-9/-]{2,31}$", QUESTION_COUNT: 25 };
  const fields = { name: "Rishab Haldar", email: " Rishab@Karunya.edu.in ", reg: "URK22CS1001", question: "7", rules: true };
  assert.equal(validateGate(fields, config), "");
  assert.equal(validateGate({ ...fields, email: "" }, config), "Enter a valid email address.");
  assert.equal(isValidEmail("no-at-sign.com"), false);
  assert.equal(isValidEmail("a@b"), false);
  assert.equal(isValidEmail("a b@c.com"), false);

  const missing = "Enter your question number (1 to 25) from the question paper.";
  assert.equal(validateGate({ ...fields, question: "" }, config), missing);
  assert.equal(validateGate({ ...fields, question: "0" }, config), missing);
  assert.equal(validateGate({ ...fields, question: "26" }, config), missing);
  assert.equal(validateGate({ ...fields, question: "2.5" }, config), missing);
  assert.equal(parseQuestionNumber(" 25 ", 25), 25);
  assert.equal(parseQuestionNumber("1e1", 25), null);
});
