/**
 * Check a report (.pdf, or the .json fallback).
 *   OK        the file is exactly what the exam produced
 *   EDITED    the sealed data is intact, but the pages or file were changed
 *   TAMPERED  the sealed data does not match its receipt
 * Exit code 0 only for OK.
 */
import fs from "node:fs";
import { jsPDF } from "jspdf";
import { verifyReportFile } from "../js/core/report-pdf.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node tools/verify-submission.mjs report.pdf");
  process.exit(2);
}
let result;
try {
  result = await verifyReportFile(fs.readFileSync(file), file, jsPDF);
} catch (error) {
  console.log(`UNREADABLE: ${error.message}`);
  process.exit(1);
}
const who = `${result.data?.payload?.student?.reg ?? "?"}, receipt ${result.data?.receipt ?? "?"}`;
if (result.status === "ok") {
  console.log(`OK: ${who}. ${result.pagesChecked ? "The file is exactly as the exam produced it." : "Data only (no pages to compare)."}`);
} else if (result.status === "edited") {
  console.log(`EDITED: ${who}. The pages or the file were changed after the exam produced it.`);
} else {
  console.log(`TAMPERED: ${who}. The sealed data does not match its receipt.`);
}
console.log("Also check this receipt against the one the student wrote on the attendance sheet.");
process.exit(result.status === "ok" ? 0 : 1);
