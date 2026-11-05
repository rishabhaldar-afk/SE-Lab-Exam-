import { applyRunMessage, createRunState, selectTranscript } from "../core/py-session.js";
import { el } from "./dom.js";

export function mountPython(parent, opts) {
  const limits = { timeoutMs: opts.runTimeoutMs, outputLimit: opts.outputLimit };
  let fontSize = opts.fontSize || 15;
  let inputs = (opts.inputs || []).slice();
  let runs = (opts.runs || []).slice();
  let runCount = opts.runCount || 0;
  let runState = createRunState();
  let editor = null;
  let internalClipboard = null;
  let active = null;
  let spare = null;
  let currentRunId = 0;
  let tick = null;
  let destroyed = false;
  let frozen = false;
  let pending = null;

  const status = el("span", { class: "py-status", role: "status" }, ["Preparing Python…"]);
  const consoleState = el("span", { class: "console-state" });
  const part = el("div", { class: "editor-head" }, [
    el("span", {}, ["Part B · Python program"]),
    el("span", { class: "editor-note" }, ["Write the program asked for on your question paper."]),
  ]);
  const editorHost = el("div", { class: "py-editor" });
  const output = el("pre", { class: "console-out" });
  const line = el("input", { type: "text", autocomplete: "off", spellcheck: "false", "aria-label": "Program input", placeholder: "Type your input and press Enter" });
  const send = el("button", { type: "submit" }, ["Send"]);
  const inputRow = el("form", { class: "console-in" }, [el("span", { class: "prompt-mark", "aria-hidden": "true" }, ["›"]), line, send]);
  inputRow.hidden = true;
  const hint = el("p", { class: "hint" });
  hint.hidden = true;
  const runBtn = el("button", { type: "button", class: "primary", title: "Run from the start (Ctrl+Enter)" }, ["Run", el("kbd", {}, ["Ctrl+Enter"])]);
  const stopBtn = el("button", { type: "button" }, ["Stop"]);
  const clearBtn = el("button", { type: "button" }, ["Clear console"]);
  const smaller = el("button", { type: "button", "aria-label": "Smaller font" }, ["A−"]);
  const larger = el("button", { type: "button", "aria-label": "Larger font" }, ["A+"]);
  const sizeLabel = el("span", { class: "font-size" }, [`${fontSize}px`]);

  function paint() {
    output.textContent = runState.visible || "";
    output.scrollTop = output.scrollHeight;
    hint.hidden = !runState.hint;
    hint.textContent = runState.hint || "";
    const busy = runState.phase === "running";
    const ended = {
      ok: ["Finished", "ok"],
      error: ["Error", "error"],
      stopped: ["Stopped", ""],
      timeout: ["Time limit", "error"],
      output_limit: ["Output limit", "error"],
    }[runState.status] || ["", ""];
    const [label, tone] = busy ? ["Running…", "busy"]
      : runState.phase === "need_input" ? ["Waiting for input", "input"]
        : runState.phase === "done" ? ended : ["", ""];
    consoleState.textContent = label;
    consoleState.dataset.state = tone;
    const showInput = runState.phase === "need_input" && !frozen;
    if (showInput && inputRow.hidden) requestAnimationFrame(() => line.focus());
    inputRow.hidden = !showInput;
    runBtn.disabled = frozen || busy || !active?._ready;
    stopBtn.disabled = frozen || !busy;
    send.disabled = frozen;
    line.disabled = frozen;
  }

  function setStatus(text, state) {
    status.textContent = text;
    status.dataset.state = state;
  }

  function stopTick() {
    if (tick) clearInterval(tick);
    tick = null;
  }

  function recordRun() {
    runs = runs.concat([{
      ts: new Date().toISOString(),
      inputs: inputs.slice(),
      transcript: runState.transcript,
      status: runState.status,
    }]).slice(-5);
    runCount += 1;
    opts.onRuns?.();
  }

  function killActive() {
    if (!active) return;
    const dead = active;
    dead.terminate();
    active = spare;
    spare = spawn();
    if (active?._ready) setStatus("Python ready", "ready");
    else setStatus("Preparing Python…", "busy");
  }

  function push(message, now = Date.now()) {
    const result = applyRunMessage(runState, message, now, limits);
    runState = result.state;
    if (result.actions.includes("terminate")) killActive();
    if (result.actions.includes("finished") || result.actions.includes("wait-input")) {
      stopTick();
      recordRun();
    }
    if (result.actions.includes("show-hint")) opts.onToast?.(runState.hint);
    paint();
  }

  function onWorkerMessage(worker, data) {
    if (destroyed || worker !== active || !data) return;
    if (data.type === "ready") {
      worker._ready = true;
      setStatus("Python ready", "ready");
      paint();
      if (pending && worker === active) {
        const next = pending;
        pending = null;
        begin(next);
      }
      return;
    }
    if (data.type === "boot-error") {
      setStatus("Python failed to start. Call the invigilator.", "error");
      return;
    }
    if (data.type === "done" && data.id !== currentRunId) return;
    if (data.type === "stdout" || data.type === "stderr" || data.type === "clear" || data.type === "need_input") {
      push(data);
      return;
    }
    if (data.type === "done") {
      push({ type: "done", status: data.status, transcript: data.transcript, error: data.error });
    }
  }

  function spawn() {
    const worker = new Worker(new URL("../py-worker.js", import.meta.url), { type: "module" });
    worker._ready = false;
    worker.addEventListener("message", (event) => onWorkerMessage(worker, event.data));
    worker.addEventListener("error", () => {
      if (worker === active) setStatus("Python failed to start. Call the invigilator.", "error");
    });
    return worker;
  }

  function begin(nextInputs) {
    if (frozen) return;
    if (!active?._ready) {
      pending = nextInputs.slice();
      setStatus("Preparing Python…", "busy");
      return;
    }
    stopTick();
    currentRunId += 1;
    const id = currentRunId;
    push({ type: "start", inputs: nextInputs });
    tick = setInterval(() => push({ type: "tick" }), 200);
    active.postMessage({
      type: "run",
      id,
      code: editor ? editor.getValue() : (opts.code || ""),
      inputs: nextInputs,
    });
  }

  function submitLine() {
    if (runState.phase !== "need_input" || frozen) return;
    inputs = inputs.concat([line.value]);
    line.value = "";
    opts.onDirty?.();
    begin(inputs);
  }

  // Run starts the program from the top with no typed lines. Only the console
  // input row replays the lines typed during the current run.
  function runFresh() {
    if (frozen || runState.phase === "running") return;
    inputs = [];
    opts.onDirty?.();
    begin(inputs);
  }

  runBtn.addEventListener("click", runFresh);
  stopBtn.addEventListener("click", () => {
    if (runState.phase !== "running") return;
    killActive();
    stopTick();
    const base = runState.visible || "";
    const text = `${base}${base.endsWith("\n") || !base ? "" : "\n"}Stopped.\n`;
    runState = { ...runState, phase: "done", status: "stopped", visible: text, transcript: text, buffer: text };
    recordRun();
    paint();
  });
  clearBtn.addEventListener("click", () => {
    if (runState.phase === "running") return;
    runState = { ...runState, visible: "", buffer: "" };
    output.textContent = "";
  });

  function applyFont() {
    sizeLabel.textContent = `${fontSize}px`;
    if (!editor) return;
    editor.getWrapperElement().style.fontSize = `${fontSize}px`;
    editor.refresh();
    opts.onDirty?.();
  }
  smaller.addEventListener("click", () => {
    fontSize = Math.max(12, fontSize - 1);
    applyFont();
  });
  larger.addEventListener("click", () => {
    fontSize = Math.min(22, fontSize + 1);
    applyFont();
  });
  inputRow.addEventListener("submit", (event) => {
    event.preventDefault();
    submitLine();
  });

  parent.append(
    el("div", { class: "toolbar" }, [
      runBtn, stopBtn, clearBtn,
      el("span", { class: "spacer" }),
      el("span", { class: "toolbar-label" }, ["Font"]), smaller, sizeLabel, larger,
      status,
    ]),
    el("div", { class: "py-layout" }, [
      el("div", { class: "py-left" }, [part, editorHost]),
      el("div", { class: "py-right" }, [
        el("div", { class: "console-head" }, [el("span", {}, ["Console"]), consoleState]),
        output, hint, inputRow,
      ]),
    ]),
  );

  if (!window.CodeMirror) {
    editorHost.append(el("p", { class: "form-error" }, ["The code editor failed to load. Call the invigilator."]));
  } else {
    const area = el("textarea");
    area.value = opts.code || "";
    editorHost.append(area);
    editor = window.CodeMirror.fromTextArea(area, {
      mode: "python",
      lineNumbers: true,
      matchBrackets: true,
      indentUnit: 4,
      tabSize: 4,
      indentWithTabs: false,
      extraKeys: {
        Tab(cm) { cm.replaceSelection("    ", "end"); },
        "Ctrl-Enter"() { runFresh(); },
        "Cmd-Enter"() { runFresh(); },
      },
    });
    editor.on("change", () => opts.onDirty?.());
    const wrapper = editor.getWrapperElement();
    wrapper.style.fontSize = `${fontSize}px`;
    wrapper.addEventListener("copy", () => { internalClipboard = editor.getSelection(); });
    wrapper.addEventListener("cut", () => { internalClipboard = editor.getSelection(); });
    wrapper.addEventListener("paste", (event) => {
      const text = event.clipboardData?.getData("text") ?? "";
      if (text !== (internalClipboard ?? null)) {
        event.preventDefault();
        event.stopPropagation();
        opts.onPasteBlocked?.();
        opts.onToast?.("Pasting from outside is disabled");
      }
    }, true);
    wrapper.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      opts.onDropBlocked?.();
    });
    wrapper.addEventListener("dragover", (event) => event.preventDefault());
  }

  active = spawn();
  spare = spawn();
  paint();

  return {
    getCode() { return editor ? editor.getValue() : (opts.code || ""); },
    getFontSize() { return fontSize; },
    getInputs() { return inputs.slice(); },
    getRuns() { return runs.map((run) => ({ ...run, inputs: run.inputs.slice() })); },
    getRunCount() { return runCount; },
    getLastTranscript() { return selectTranscript(runs); },
    refresh() { editor?.refresh(); },
    freeze() {
      frozen = true;
      editor?.setOption("readOnly", true);
      paint();
    },
    destroy() {
      destroyed = true;
      stopTick();
      active?.terminate();
      spare?.terminate();
    },
  };
}
