/** Print a PBKDF2 hash of the invigilator PIN. The PIN is read from the prompt, never from argv. */
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { hashPin } from "../js/core/crypto.js";

async function readPair(labelA, labelB) {
  if (stdin.isTTY) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      return [await rl.question(labelA), await rl.question(labelB)];
    } finally {
      rl.close();
    }
  }
  const text = await new Promise((resolve, reject) => {
    const chunks = [];
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => chunks.push(chunk));
    stdin.on("end", () => resolve(chunks.join("")));
    stdin.on("error", reject);
  });
  const lines = text.split(/\r?\n/);
  stdout.write(labelA);
  stdout.write(labelB);
  return [lines[0] ?? "", lines[1] ?? ""];
}

const [first, second] = await readPair("Invigilator PIN: ", "Confirm PIN: ");

if (first !== second) {
  console.error("PINs did not match");
  process.exit(1);
}
if (first.length < 4) {
  console.error("PIN must be at least 4 characters");
  process.exit(1);
}

const hashed = await hashPin(first);
console.log(JSON.stringify(hashed, null, 2));
