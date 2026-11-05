import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { loadPyodide } from "pyodide";

let run;

test.before(async () => {
  const pyodide = await loadPyodide();
  const examio = {
    write_out(text) { examio.chunks.push(String(text)); },
    write_err(text) { examio.chunks.push(String(text)); },
    need_input() { examio.needs += 1; },
    clear_console() { examio.clears += 1; },
    chunks: [],
    needs: 0,
    clears: 0,
  };
  pyodide.registerJsModule("examio", examio);
  pyodide.runPython(`
import sys
from types import ModuleType
mod = ModuleType("_exam_runner")
sys.modules["_exam_runner"] = mod
`);
  const mod = pyodide.pyimport("_exam_runner");
  const source = fs.readFileSync(new URL("../py/runner.py", import.meta.url), "utf8");
  pyodide.runPython(source, { globals: mod.__dict__, filename: "runner.py" });
  run = (code, inputs = []) => {
    examio.chunks = [];
    examio.needs = 0;
    examio.clears = 0;
    const pyInputs = pyodide.toPy(inputs);
    let raw;
    try {
      raw = mod.run_user(code, pyInputs);
    } finally {
      pyInputs.destroy?.();
    }
    return JSON.parse(String(raw));
  };
});

function readReference(name) {
  return fs.readFileSync(new URL(`../private/reference/${name}`, import.meta.url), "utf8");
}

test("organic, semi-detached, and embedded COCOMO golden values", () => {
  const code = readReference("cocomo.py");
  const organic = run(code, ["1", "32", "4"]);
  assert.equal(organic.status, "ok");
  assert.match(organic.transcript, /Effort \(person-months\): 91\.33/);
  assert.match(organic.transcript, /Development time \(months\): 13\.90/);
  assert.match(organic.transcript, /Average team size: 6\.57/);

  const semi = run(code, ["2", "50", "4"]);
  assert.match(semi.transcript, /239\.87/);
  assert.match(semi.transcript, /17\.02/);
  assert.match(semi.transcript, /14\.09/);

  const embedded = run(code, ["3", "100", "4"]);
  assert.match(embedded.transcript, /904\.28/);
  assert.match(embedded.transcript, /22\.08/);
  assert.match(embedded.transcript, /40\.96/);
});

test("defect density, DRE, and MTTC golden values", () => {
  const result = run(readReference("metrics_dd.py"), ["1", "45", "15", "2", "80", "20", "3", "2,4,6,4", "4"]);
  assert.equal(result.status, "ok");
  assert.match(result.transcript, /Defect Density: 3\.00/);
  assert.match(result.transcript, /DRE: 0\.80/);
  assert.match(result.transcript, /MTTC: 4\.00/);
});

test("SMI, SPI, and CPI golden values", () => {
  const result = run(readReference("metrics_smi.py"), ["1", "100", "10", "15", "5", "2", "40000", "50000", "3", "40000", "45000", "4"]);
  assert.equal(result.status, "ok");
  assert.match(result.transcript, /SMI: 0\.70/);
  assert.match(result.transcript, /SPI: 0\.80/);
  assert.match(result.transcript, /CPI: 0\.8889/);
});

test("input inside nested functions replays", () => {
  const result = run(`
def inner():
    return input("N: ")
def outer():
    return inner()
print("[" + outer() + "]")
`, ["hi"]);
  assert.equal(result.status, "ok");
  assert.match(result.transcript, /N: hi\n\[hi\]/);
});

test("except Exception does not swallow NeedInput", () => {
  const result = run(`
try:
    input("A: ")
except Exception:
    print("caught-exception")
print("done")
`, []);
  assert.equal(result.status, "need_input");
  assert.equal(result.transcript, "A: ");
  assert.doesNotMatch(result.transcript, /caught-exception/);
});

test("bare except around input is silenced and reported as ok to the host", () => {
  const result = run(`
try:
    input("Name: ")
except:
    print("swallowed")
print("after")
`, []);
  assert.equal(result.status, "ok");
  assert.equal(result.transcript, "Name: ");
  assert.doesNotMatch(result.transcript, /swallowed/);
});

test("sys.exit ends normally", () => {
  const result = run(`
import sys
print("bye")
sys.exit(0)
print("nope")
`);
  assert.equal(result.status, "ok");
  assert.match(result.transcript, /bye/);
  assert.doesNotMatch(result.transcript, /nope/);
});

test("os.system cls clears the transcript", () => {
  const result = run(`
import os
print("before")
os.system("cls")
print("after")
`);
  assert.equal(result.status, "ok");
  assert.equal(result.transcript, "after\n");
});

test("syntax error names main.py", () => {
  const result = run("def (\n");
  assert.equal(result.status, "error");
  assert.match(result.error, /File "main.py"/);
  assert.match(result.transcript, /SyntaxError/);
});

test("runtime error strips runner frames", () => {
  const result = run(`
def boom():
    raise RuntimeError("boom")
boom()
`);
  assert.equal(result.status, "error");
  assert.match(result.error, /File "main.py", line \d+, in boom/);
  assert.match(result.error, /RuntimeError: boom/);
  assert.doesNotMatch(result.error, /run_user/);
});

test("friendly message for numpy and a block for socket", () => {
  const numpy = run("import numpy\n");
  assert.match(numpy.error, /Only the standard library is available in this exam/);
  const socket = run("import socket\n");
  assert.match(socket.error, /disabled in this exam/);
  const client = run("import http.client\n");
  assert.match(client.error, /disabled in this exam/);
});

test("prompts have no extra newline and queued input is echoed", () => {
  const result = run(`
name = input("Name? ")
print(name)
`, ["Ada"]);
  assert.equal(result.transcript.startsWith("Name? Ada\nAda\n"), true);
});
