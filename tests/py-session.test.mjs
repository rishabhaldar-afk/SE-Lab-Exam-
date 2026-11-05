import assert from "node:assert/strict";
import { test } from "node:test";
import { applyRunMessage, createRunState, selectTranscript, SWALLOW_HINT } from "../js/core/py-session.js";

const limits = { timeoutMs: 5000, outputLimit: 20 };

function run(messages) {
  let state = createRunState();
  const seen = [];
  for (const message of messages) {
    const result = applyRunMessage(state, message, message.now, limits);
    state = result.state;
    seen.push(result.actions);
  }
  return { state, seen };
}

test("replay output stays hidden until 300ms, need_input, or done", () => {
  const started = applyRunMessage(createRunState(), { type: "start", inputs: [] }, 0, limits);
  const early = applyRunMessage(started.state, { type: "stdout", text: "hi" }, 100, limits);
  assert.equal(early.state.visible, "");
  const later = applyRunMessage(early.state, { type: "tick" }, 400, limits);
  assert.equal(later.state.visible, "hi");
  const done = applyRunMessage(later.state, { type: "done", status: "ok", transcript: "hi\n" }, 500, limits);
  assert.match(done.state.visible, /Program finished/);
  assert.ok(done.actions.includes("finished"));
});

test("a continuous run past the timeout asks to terminate", () => {
  let state = applyRunMessage(createRunState(), { type: "start" }, 0, limits).state;
  const result = applyRunMessage(state, { type: "tick" }, 5000, limits);
  assert.equal(result.state.status, "timeout");
  assert.match(result.state.visible, /Time limit exceeded/);
  assert.ok(result.actions.includes("terminate"));
});

test("output over the limit terminates", () => {
  let state = applyRunMessage(createRunState(), { type: "start" }, 0, limits).state;
  const result = applyRunMessage(state, { type: "stdout", text: "x".repeat(21) }, 10, limits);
  assert.equal(result.state.status, "output_limit");
  assert.ok(result.actions.includes("terminate"));
});

test("need_input without done within 1.5s is the bare-except hint", () => {
  let state = applyRunMessage(createRunState(), { type: "start" }, 0, limits).state;
  state = applyRunMessage(state, { type: "need_input" }, 100, limits).state;
  const result = applyRunMessage(state, { type: "tick" }, 1700, limits);
  assert.equal(result.state.hint, SWALLOW_HINT);
  assert.equal(result.state.phase, "need_input");
  assert.ok(result.actions.includes("terminate"));
});

test("selectTranscript prefers the last finished run", () => {
  const text = selectTranscript([
    { status: "need_input", transcript: "partial" },
    { status: "ok", transcript: "full" },
    { status: "need_input", transcript: "again" },
  ]);
  assert.equal(text, "full");
});

test("clear wipes the visible buffer", () => {
  const { state } = run([
    { type: "start", now: 0 },
    { type: "stdout", text: "before\n", now: 400 },
    { type: "clear", now: 500 },
  ]);
  assert.equal(state.visible, "");
});
