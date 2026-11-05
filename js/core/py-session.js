/** Message reducer for one Python run. The UI owns the worker. */

export const SWALLOW_HINT = "Don't wrap input() in a bare except:";
export const TIMEOUT_LINE = "Time limit exceeded (infinite loop?).";
export const OUTPUT_LINE = "Output limit exceeded.";
const PAINT_MS = 300;
const SWALLOW_MS = 1500;

export function createRunState() {
  return {
    phase: "idle",
    buffer: "",
    visible: "",
    bytes: 0,
    runStartedAt: 0,
    lastPaintAt: 0,
    needInputAt: null,
    sawNeedInput: false,
    status: null,
    hint: null,
    transcript: "",
    error: null,
    inputs: [],
  };
}

function finish(state, status, extraLine) {
  let buffer = state.buffer;
  if (extraLine) {
    if (buffer && !buffer.endsWith("\n")) buffer += "\n";
    buffer += extraLine + "\n";
  }
  return {
    ...state,
    phase: "done",
    status,
    buffer,
    visible: buffer,
    transcript: buffer,
  };
}

export function applyRunMessage(state, message, now, limits) {
  const actions = [];
  if (message.type === "start") {
    return {
      state: {
        ...createRunState(),
        phase: "running",
        runStartedAt: now,
        lastPaintAt: now,
        inputs: Array.isArray(message.inputs) ? message.inputs.slice() : [],
      },
      actions,
      paint: true,
    };
  }

  if (state.phase === "idle" || state.phase === "done" || state.phase === "need_input") {
    return { state, actions, paint: false };
  }

  if (message.type === "stdout" || message.type === "stderr") {
    const text = String(message.text ?? "");
    const bytes = state.bytes + text.length;
    const buffer = state.buffer + text;
    if (bytes > limits.outputLimit) {
      const next = finish({ ...state, buffer, bytes }, "output_limit", OUTPUT_LINE);
      return { state: next, actions: ["terminate", "finished"], paint: true };
    }
    let next = { ...state, buffer, bytes };
    let paint = false;
    if (now - state.lastPaintAt >= PAINT_MS) {
      next = { ...next, visible: buffer, lastPaintAt: now };
      paint = true;
    }
    return { state: next, actions, paint };
  }

  if (message.type === "clear") {
    return {
      state: { ...state, buffer: "", visible: "", bytes: 0 },
      actions,
      paint: true,
    };
  }

  if (message.type === "need_input") {
    return {
      state: {
        ...state,
        sawNeedInput: true,
        needInputAt: now,
        visible: state.buffer,
        lastPaintAt: now,
      },
      actions,
      paint: true,
    };
  }

  if (message.type === "tick") {
    if (!state.sawNeedInput && now - state.runStartedAt >= limits.timeoutMs) {
      const next = finish(state, "timeout", TIMEOUT_LINE);
      return { state: next, actions: ["terminate", "finished"], paint: true };
    }
    if (state.sawNeedInput && state.needInputAt != null && now - state.needInputAt >= SWALLOW_MS) {
      return {
        state: {
          ...state,
          phase: "need_input",
          status: "need_input",
          hint: SWALLOW_HINT,
          visible: state.buffer,
          transcript: state.buffer,
        },
        actions: ["terminate", "show-hint", "wait-input"],
        paint: true,
      };
    }
    if (now - state.lastPaintAt >= PAINT_MS && state.visible !== state.buffer) {
      return {
        state: { ...state, visible: state.buffer, lastPaintAt: now },
        actions,
        paint: true,
      };
    }
    return { state, actions, paint: false };
  }

  if (message.type === "done") {
    const status = message.status || "ok";
    if (state.sawNeedInput && status !== "need_input") {
      return {
        state: {
          ...state,
          phase: "need_input",
          status: "need_input",
          hint: SWALLOW_HINT,
          visible: state.buffer,
          transcript: state.buffer,
        },
        actions: ["show-hint", "wait-input"],
        paint: true,
      };
    }
    if (status === "need_input") {
      return {
        state: {
          ...state,
          phase: "need_input",
          status: "need_input",
          hint: null,
          visible: state.buffer,
          transcript: state.buffer,
        },
        actions: ["wait-input"],
        paint: true,
      };
    }
    let buffer = message.transcript != null ? String(message.transcript) : state.buffer;
    if (message.error && !buffer.includes(String(message.error))) {
      if (buffer && !buffer.endsWith("\n")) buffer += "\n";
      buffer += String(message.error);
      if (!buffer.endsWith("\n")) buffer += "\n";
    }
    if (status === "ok") {
      if (buffer && !buffer.endsWith("\n")) buffer += "\n";
      if (!buffer.includes("Program finished")) buffer += "Program finished\n";
    }
    return {
      state: {
        ...state,
        phase: "done",
        status,
        buffer,
        visible: buffer,
        transcript: buffer,
        error: message.error || null,
        hint: null,
      },
      actions: ["finished"],
      paint: true,
    };
  }

  return { state, actions, paint: false };
}

export function selectTranscript(runs) {
  if (!Array.isArray(runs) || runs.length === 0) return "";
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    if (runs[i].status !== "need_input") return runs[i].transcript || "";
  }
  return runs[runs.length - 1].transcript || "";
}
