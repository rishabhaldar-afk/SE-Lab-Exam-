/** CSV of submissions in a directory. Diagram cell counts are a rough effort indicator, not a grade. */
import fs from "node:fs";
import path from "node:path";
import { jsPDF } from "jspdf";
import { verifyReportFile } from "../js/core/report-pdf.js";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node tools/summarize.mjs dir/");
  process.exit(2);
}

function cell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

const header = [
  "regno",
  "name",
  "email",
  "question",
  "start",
  "submit",
  "minutes_used",
  "major_events",
  "minor_events",
  "lock_count",
  "run_count",
  "code_lines",
  "diagram1_cells",
  "diagram2_cells",
  "receipt",
  "integrity",
];

console.error("Diagram cell counts are a rough effort indicator, not a grade.");
console.log(header.join(","));

const files = fs.readdirSync(dir).filter((name) => /\.(pdf|json)$/i.test(name)).sort();
for (const name of files) {
  let result;
  try {
    result = await verifyReportFile(fs.readFileSync(path.join(dir, name)), name, jsPDF);
  } catch {
    console.log([name, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "UNREADABLE"].map(cell).join(","));
    continue;
  }
  const payload = result.data.payload;
  const start = Date.parse(payload.startedAt);
  const end = Date.parse(payload.submittedAt);
  const minutes = Number.isFinite(start) && Number.isFinite(end) ? ((end - start) / 60000).toFixed(1) : "";
  const diagrams = payload.diagrams || [];
  const row = [
    payload.student?.reg,
    payload.student?.name,
    payload.student?.email,
    payload.question?.id,
    payload.startedAt,
    payload.submittedAt,
    minutes,
    payload.majorEvents,
    payload.minorEvents,
    payload.lockCount,
    payload.runCount,
    String(payload.code || "").split("\n").length,
    diagrams[0]?.cells ?? "",
    diagrams[1]?.cells ?? "",
    result.data?.receipt,
    result.status.toUpperCase(),
  ];
  console.log(row.map(cell).join(","));
}
