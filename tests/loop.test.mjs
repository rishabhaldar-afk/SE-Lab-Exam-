import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker } from "node:worker_threads";

function startWorker() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./py-loop-worker.mjs", import.meta.url));
    const onMessage = (message) => {
      if (message.type === "ready") {
        worker.off("message", onMessage);
        resolve(worker);
      }
    };
    worker.on("message", onMessage);
    worker.on("error", reject);
  });
}

test("an infinite loop in the worker does not freeze the parent", { timeout: 120000 }, async () => {
  const worker = await startWorker();
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 100);
  worker.postMessage({ type: "run", code: "while True:\n    pass\n", inputs: [] });
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.ok(ticks >= 2, "parent timer kept firing");
  await worker.terminate();
  clearInterval(timer);
});

test("endless print can be terminated from the parent", { timeout: 120000 }, async () => {
  const worker = await startWorker();
  let bytes = 0;
  let parentTick = false;
  const timer = setTimeout(() => { parentTick = true; }, 200);
  worker.on("message", (message) => {
    if (message.type === "stdout") bytes += message.text.length;
  });
  worker.postMessage({ type: "run", code: "while True:\n    print('x')\n", inputs: [] });
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(parentTick, true);
  assert.ok(bytes > 0);
  await worker.terminate();
  clearTimeout(timer);
});
