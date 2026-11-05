import fs from "node:fs";
import { parentPort } from "node:worker_threads";
import { loadPyodide } from "pyodide";

const pyodide = await loadPyodide();
pyodide.registerJsModule("examio", {
  write_out(text) { parentPort.postMessage({ type: "stdout", text: String(text) }); },
  write_err(text) { parentPort.postMessage({ type: "stderr", text: String(text) }); },
  need_input() { parentPort.postMessage({ type: "need_input" }); },
  clear_console() { parentPort.postMessage({ type: "clear" }); },
});
pyodide.runPython(`
import sys
from types import ModuleType
mod = ModuleType("_exam_runner")
sys.modules["_exam_runner"] = mod
`);
const mod = pyodide.pyimport("_exam_runner");
const source = fs.readFileSync(new URL("../py/runner.py", import.meta.url), "utf8");
pyodide.runPython(source, { globals: mod.__dict__, filename: "runner.py" });
parentPort.postMessage({ type: "ready" });
parentPort.on("message", (message) => {
  if (message.type !== "run") return;
  const inputs = pyodide.toPy(message.inputs || []);
  try {
    const raw = mod.run_user(message.code, inputs);
    parentPort.postMessage({ type: "done", raw: String(raw) });
  } finally {
    inputs.destroy?.();
  }
});
