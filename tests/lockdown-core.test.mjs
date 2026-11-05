import assert from "node:assert/strict";
import { test } from "node:test";
import { remainingMs } from "../js/core/storage.js";
import {
  applyEvent,
  createLockdownState,
  noteFullscreenTransition,
  reduceTabRole,
  setScoring,
  unlockSession,
} from "../js/core/lockdown-core.js";

function major(state, type, ts, extra = {}) {
  return applyEvent(state, { type, ts, detail: type, ...extra });
}

test("events inside 1500ms are one incident", () => {
  let state = createLockdownState({ maxViolations: 3, examStartMs: 1000 });
  state = major(state, "FS_EXIT", 5000).state;
  state = major(state, "FOCUS_LOST", 5200).state;
  state = major(state, "TAB_HIDDEN", 6400).state;
  assert.equal(state.violations, 1);
  assert.equal(state.majorEvents, 3);
  assert.equal(state.overlay, true);
  assert.equal(state.locked, false);
});

test("a later event is a new incident and the third locks", () => {
  let state = createLockdownState({ maxViolations: 3, examStartMs: 0 });
  state = major(state, "FS_EXIT", 1000).state;
  state = major(state, "TAB_HIDDEN", 3000).state;
  const locked = major(state, "FOCUS_LOST", 5000);
  assert.equal(locked.state.violations, 3);
  assert.ok(locked.actions.includes("lock"));
  assert.equal(locked.state.locked, true);
  assert.equal(locked.state.lockCount, 1);
});

test("unlock clears the lock and the incident counter", () => {
  let state = createLockdownState({ maxViolations: 1, examStartMs: 0 });
  state = major(state, "SECOND_TAB", 1000).state;
  assert.equal(state.locked, true);
  state = unlockSession(state, 2000);
  assert.equal(state.locked, false);
  assert.equal(state.overlay, false);
  assert.equal(state.violations, 0);
  assert.equal(state.eventLog.at(-1).type, "INVIGILATOR");
});

test("iframe focus and the fullscreen grace are not scored", () => {
  let state = createLockdownState({ examStartMs: 0 });
  state = noteFullscreenTransition(state, 1000);
  const grace = applyEvent(state, { type: "FOCUS_LOST", ts: 1500, detail: "blur" });
  assert.deepEqual(grace.actions, ["ignore-focus"]);
  assert.equal(grace.state.violations, 0);
  const iframe = applyEvent(state, { type: "FOCUS_LOST", ts: 9000, detail: "blur", activeIsIframe: true });
  assert.equal(iframe.state.violations, 0);
  assert.equal(iframe.state.majorEvents, 0);
});

test("SEB ignores fullscreen and focus scoring but logs detection", () => {
  let state = createLockdownState({ seb: true, examStartMs: 0 });
  state = applyEvent(state, { type: "SEB_DETECTED", ts: 1, detail: "ua" }).state;
  state = major(state, "FS_EXIT", 1000).state;
  state = major(state, "FOCUS_LOST", 3000).state;
  const hidden = major(state, "TAB_HIDDEN", 5000);
  assert.equal(hidden.state.violations, 1);
  assert.equal(state.eventLog.some((entry) => entry.type === "SEB_DETECTED"), true);
});

test("the timer does not read lockdown state", () => {
  const before = remainingMs(1_000, 61_000, 120, null, 0);
  let state = createLockdownState({ examStartMs: 1_000 });
  state = major(state, "FS_EXIT", 5_000).state;
  state = unlockSession(state, 9_000);
  assert.equal(remainingMs(1_000, 61_000, 120, null, 0), before);
  assert.equal(before, 120 * 60 * 1000 - 60_000);
  assert.equal(state.locked, false);
});

test("scoring off does not increment", () => {
  let state = setScoring(createLockdownState(), false);
  state = major(state, "FS_EXIT", 1000).state;
  assert.equal(state.violations, 0);
  assert.equal(state.overlay, false);
});

test("second tab: the owner stays, the new tab blocks", () => {
  const owner = reduceTabRole("owner", "bbb", { type: "hello", tabId: "aaa" });
  assert.equal(owner.role, "owner");
  assert.ok(owner.actions.includes("foreign-tab"));
  const pending = reduceTabRole("pending", "bbb", { type: "hello", tabId: "aaa" });
  assert.equal(pending.role, "blocked");
  const busy = reduceTabRole("pending", "bbb", { type: "busy", tabId: "aaa", to: "bbb" });
  assert.equal(busy.role, "blocked");
});
