import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { jsPDF } from "jspdf";
import {
  canonicalStringify,
  countDiagramCells,
  createPayload,
  reportFilename,
  sealSubmission,
} from "../js/core/report.js";
import {
  buildReportPdf,
  bytesToBase64,
  extractSubmissionPdf,
  formatDuration,
  formatWhen,
  pdfSafe,
  verifySubmissionPdf,
} from "../js/core/report-pdf.js";

const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="User" vertex="1"/></root></mxGraphModel>';

function payload() {
  return createPayload({
    buildId: "build-test-123",
    configVersion: 1,
    name: "<img src=x onerror=alert(1)> Ünïcødé 名前",
    email: "student@karunya.edu.in",
    reg: "22BCE1001",
    questionId: 1,
    startedAt: Date.parse("2026-11-03T10:13:45.711Z"),
    submittedAt: Date.parse("2026-11-03T10:14:13.004Z"),
    code: "print('</script>') # (paren) \\ back\n\tindented\n",
    runCount: 2,
    lastTranscript: "hello\n",
    recentRuns: [],
    diagrams: [
      { xml, png: null, pngError: null },
      { xml: "", png: "javascript:alert(1)", pngError: "bad" },
    ],
    incidents: 1,
    majorEvents: 2,
    minorEvents: 0,
    lockCount: 0,
    eventLog: [{ iso: "2026-11-03T10:14:00.000Z", ms: 14289, type: "FS_EXIT", detail: "<b>", scored: true }],
    userAgent: "Test",
    seb: false,
  });
}

function pdfFor(sealed) {
  return new Uint8Array(buildReportPdf(sealed, jsPDF, { title: "Lab Exam", course: "SE", timeZone: "Asia/Kolkata" }));
}

function inflatedText(bytes) {
  // Page content streams are Flate-compressed; inflate them to search the visible text.
  const raw = Buffer.from(bytes).toString("latin1");
  let text = "";
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      text += zlib.inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
    } catch {
      text += match[1];
    }
  }
  return text;
}

test("canonical JSON is stable and the receipt groups 12 hex chars", async () => {
  const sealed = await sealSubmission(payload());
  assert.equal(canonicalStringify(sealed.payload), canonicalStringify(JSON.parse(canonicalStringify(sealed.payload))));
  assert.match(sealed.receipt, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
});

test("dates and durations read like a person wrote them", () => {
  assert.equal(formatWhen("2026-11-03T10:13:45.711Z", "Asia/Kolkata"), "3 Nov 2026, 3:43:45 pm IST");
  assert.equal(formatDuration(27_293), "27 sec");
  assert.equal(formatDuration(12 * 60_000 + 5_000), "12 min 05 sec");
  assert.equal(formatDuration(105 * 60_000), "1 hr 45 min");
  assert.equal(pdfSafe("a—b “q” 名"), 'a-b "q" ?');
});

test("the PDF round-trips the submission, hides the build id, and rejects an edit", async () => {
  const sealed = await sealSubmission(payload());
  const bytes = pdfFor(sealed);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("latin1"), "%PDF-");

  const ok = await verifySubmissionPdf(bytes);
  assert.equal(ok.ok, true);
  assert.equal(ok.data.payload.code, "print('</script>') # (paren) \\ back\n\tindented\n");
  assert.equal(ok.data.payload.student.name, "<img src=x onerror=alert(1)> Ünïcødé 名前");
  assert.equal(ok.data.payload.diagrams[1].png, null);

  const visible = inflatedText(bytes);
  assert.equal(visible.includes("build-test-123"), false);
  assert.match(visible, /3 Nov 2026, 3:43:45 pm IST/);
  assert.match(visible, /27 sec/);
  assert.match(visible, /student@karunya\.edu\.in/);
  assert.equal(ok.data.payload.student.email, "student@karunya.edu.in");

  // Re-embed an edited payload with the original hash: verification must fail.
  const data = extractSubmissionPdf(bytes);
  data.payload.lastTranscript = "hellp\n";
  const forged = `LABEXAM-SUBMISSION-1:${bytesToBase64(new TextEncoder().encode(canonicalStringify(data)))}:END-LABEXAM`;
  const raw = Buffer.from(bytes).toString("latin1").replace(/LABEXAM-SUBMISSION-1:[A-Za-z0-9+/=]+:END-LABEXAM/, forged);
  const tampered = await verifySubmissionPdf(new Uint8Array(Buffer.from(raw, "latin1")), jsPDF);
  assert.equal(tampered.ok, false);
  assert.equal(tampered.status, "tampered");

  assert.equal(countDiagramCells(xml), 1);
  assert.equal(reportFilename("22 BCE 1001", "A B", 1), "22_BCE_1001_A_B_Q1_report.pdf");
});

test("the PDF is the same bytes every time, so any edit to the file is caught", async () => {
  const sealed = await sealSubmission(payload());
  const bytes = pdfFor(sealed);
  assert.deepEqual(pdfFor(sealed), bytes);

  const good = await verifySubmissionPdf(bytes, jsPDF);
  assert.equal(good.status, "ok");
  assert.equal(good.pagesChecked, true);
  assert.match(inflatedText(bytes), /SEALED/);
  assert.match(inflatedText(bytes), /Any edit to this file is detected\./);

  // Change visible text but leave the sealed data alone, as a PDF editor would.
  const raw = Buffer.from(bytes).toString("latin1");
  const retitled = raw.replace("/Title (Lab exam report - 22BCE1001", "/Title (Lab exam report - 22BCE1009");
  assert.notEqual(retitled, raw);
  const edited = await verifySubmissionPdf(new Uint8Array(Buffer.from(retitled, "latin1")), jsPDF);
  assert.equal(edited.status, "edited");
  assert.equal(edited.ok, false);

  // Re-saving adds or rewrites bytes: also caught.
  const resaved = await verifySubmissionPdf(new Uint8Array(Buffer.concat([Buffer.from(bytes), Buffer.from("%resaved\n")])), jsPDF);
  assert.equal(resaved.status, "edited");

  // Someone who rebuilds a fake with the open-source code gets a consistent file,
  // but a different receipt from the one written on the attendance sheet.
  const fake = payload();
  fake.code = "print('copied')\n";
  const fakeSealed = await sealSubmission(fake);
  assert.equal((await verifySubmissionPdf(pdfFor(fakeSealed), jsPDF)).status, "ok");
  assert.notEqual(fakeSealed.receipt, sealed.receipt);
});

test("verify and summarize tools on three submissions", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exam-reports-"));
  const names = ["22BCE1001", "22BCE1002", "22BCE1003"];
  for (const reg of names) {
    const body = payload();
    body.student = { ...body.student, reg, name: `Student ${reg}` };
    const sealed = await sealSubmission(body);
    fs.writeFileSync(path.join(dir, `${reg}.pdf`), pdfFor(sealed));
  }
  const verify = spawnSync(process.execPath, ["tools/verify-submission.mjs", path.join(dir, "22BCE1001.pdf")], { encoding: "utf8" });
  assert.equal(verify.status, 0);
  assert.match(verify.stdout, /^OK: 22BCE1001, receipt .+exactly as the exam produced it/);
  assert.match(verify.stdout, /attendance sheet/);

  const edit = path.join(dir, "22BCE1003.pdf");
  fs.writeFileSync(edit, Buffer.concat([fs.readFileSync(edit), Buffer.from("%x\n")]));
  const edited = spawnSync(process.execPath, ["tools/verify-submission.mjs", edit], { encoding: "utf8" });
  assert.equal(edited.status, 1);
  assert.match(edited.stdout, /^EDITED: 22BCE1003/);

  const file = path.join(dir, "22BCE1002.pdf");
  const data = extractSubmissionPdf(fs.readFileSync(file));
  data.payload.student.name = "Student 22BCE1009";
  const forged = `LABEXAM-SUBMISSION-1:${bytesToBase64(new TextEncoder().encode(canonicalStringify(data)))}:END-LABEXAM`;
  const raw = fs.readFileSync(file).toString("latin1").replace(/LABEXAM-SUBMISSION-1:[A-Za-z0-9+/=]+:END-LABEXAM/, forged);
  fs.writeFileSync(file, Buffer.from(raw, "latin1"));
  const bad = spawnSync(process.execPath, ["tools/verify-submission.mjs", file], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /TAMPERED/);

  const summary = spawnSync(process.execPath, ["tools/summarize.mjs", dir], { encoding: "utf8" });
  assert.equal(summary.status, 0);
  assert.match(summary.stderr, /rough effort indicator, not a grade/);
  const lines = summary.stdout.trim().split(/\n/);
  assert.equal(lines.length, 4);
  assert.match(lines[0], /regno,name,email,question/);
  assert.match(lines[1], /student@karunya\.edu\.in/);
  assert.match(lines[1], /22BCE1001/);
  assert.match(lines[0], /,receipt,integrity$/);
  assert.match(lines[1], /,[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4},OK$/);
  assert.match(lines[2], /,TAMPERED$/);
  assert.match(lines[3], /,EDITED$/);
});
