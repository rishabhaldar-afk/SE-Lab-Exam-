import { loadPyodide } from "../vendor/pyodide/pyodide.mjs";

const indexURL = new URL("../vendor/pyodide/", import.meta.url).href;

const examio = {
  write_out(text) {
    self.postMessage({ type: "stdout", text: String(text) });
  },
  write_err(text) {
    self.postMessage({ type: "stderr", text: String(text) });
  },
  need_input(prompt) {
    self.postMessage({ type: "need_input", prompt: String(prompt ?? "") });
  },
  clear_console() {
    self.postMessage({ type: "clear" });
  },
};

let pyodide = null;
let runUser = null;

const readyPromise = (async () => {
  pyodide = await loadPyodide({
    indexURL,
    stdout() {},
    stderr() {},
  });
  pyodide.registerJsModule("examio", examio);
  pyodide.runPython(`
import sys
from types import ModuleType
mod = ModuleType("_exam_runner")
sys.modules["_exam_runner"] = mod
`);
  const mod = pyodide.pyimport("_exam_runner");
  const response = await fetch(new URL("../py/runner.py", import.meta.url));
  if (!response.ok) throw new Error("Could not load py/runner.py");
  pyodide.runPython(await response.text(), { globals: mod.__dict__, filename: "runner.py" });
  runUser = mod.run_user;
  self.postMessage({ type: "ready" });
})();

readyPromise.catch((error) => {
  self.postMessage({ type: "boot-error", error: String(error && error.message ? error.message : error) });
});

self.onmessage = async (event) => {
  try {
    await readyPromise;
  } catch {
    return;
  }
  const msg = event.data || {};
  if (msg.type !== "run" || !runUser) return;
  const pyInputs = pyodide.toPy(msg.inputs || []);
  try {
    const raw = runUser(msg.code ?? "", pyInputs);
    const parsed = JSON.parse(String(raw));
    self.postMessage({ type: "done", id: msg.id, ...parsed });
  } catch (error) {
    self.postMessage({
      type: "done",
      id: msg.id,
      status: "error",
      transcript: "",
      error: String(error && error.message ? error.message : error),
    });
  } finally {
    pyInputs.destroy?.();
  }
};
