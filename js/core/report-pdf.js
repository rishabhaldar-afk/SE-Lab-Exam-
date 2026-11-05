/**
 * The submission report as an A4 PDF. The sealed submission JSON is embedded
 * in the PDF's XMP metadata (base64, uncompressed) so the teacher tools can
 * verify it. Pass the jsPDF class in: the page uses the vendored UMD build,
 * the tests use the npm package.
 */
import { canonicalStringify, isPngDataUri, verifySubmissionObject } from "./report.js";

const MARK_START = "LABEXAM-SUBMISSION-1:";
const MARK_END = ":END-LABEXAM";

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 16;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - 18;
const PT_TO_MM = 0.3528;

const INK = [19, 32, 51];
const MUTED = [91, 102, 120];
const BRAND = [18, 53, 91];
const LINE = [217, 223, 231];
const SOFT = [247, 249, 251];
const AMBER = [154, 88, 6];

const EVENT_LABELS = {
  FS_EXIT: "Left fullscreen",
  TAB_HIDDEN: "Tab hidden",
  FOCUS_LOST: "Window lost focus",
  SECOND_TAB: "Opened in a second tab",
  PASTE_BLOCKED: "Paste blocked",
  DROP_BLOCKED: "Drop blocked",
  CONTEXTMENU: "Right-click",
  DEVTOOLS_KEY: "Developer tools key",
  PRINT_KEY: "Print key",
  RELOAD_KEY: "Reload key",
  UNLOAD_ATTEMPT: "Tried to leave the page",
  INVIGILATOR: "Invigilator action",
  SEB_DETECTED: "Safe Exam Browser detected",
  UML_EDITOR_UNAVAILABLE: "Diagram editor did not load",
};

/** "3 Nov 2026, 3:43:45 pm IST" in the given or local time zone. */
export function formatWhen(iso, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso ?? "");
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short",
    timeZone,
  }).format(date);
}

function formatClockTime(iso, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true, timeZone }).format(date);
}

/** "27 sec", "12 min 05 sec", "1 hr 45 min". */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (hours) return `${hours} hr ${pad(minutes)} min`;
  if (minutes) return `${minutes} min ${pad(seconds)} sec`;
  return `${seconds} sec`;
}

function sinceStart(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const pad = (n) => String(n).padStart(2, "0");
  return `+${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** The built-in PDF fonts cover Latin-1 only. Anything else becomes "?". */
export function pdfSafe(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/•/g, "*")
    .replace(/[^\n\x20-\x7E\xA0-\xFF]/g, "?");
}

export function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The sealed submission plus the settings the PDF was drawn with, so the
 * verify tool can draw it again and compare. `render` is not part of the hash.
 */
function embedSubmission(sealed, render) {
  const json = canonicalStringify({ hash: sealed.hash, payload: sealed.payload, receipt: sealed.receipt, render });
  return `${MARK_START}${bytesToBase64(new TextEncoder().encode(json))}${MARK_END}`;
}

/** Read the sealed submission back out of PDF bytes. */
export function extractSubmissionPdf(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = "";
  for (let i = 0; i < view.length; i += 0x8000) text += String.fromCharCode(...view.subarray(i, i + 0x8000));
  const start = text.indexOf(MARK_START);
  const end = start < 0 ? -1 : text.indexOf(MARK_END, start);
  if (start < 0 || end < 0) throw new Error("No submission data in this PDF");
  const encoded = text.slice(start + MARK_START.length, end);
  return JSON.parse(new TextDecoder().decode(base64ToBytes(encoded)));
}

/**
 * Check a report PDF.
 * - "tampered": the sealed data does not match its receipt.
 * - "edited": the data is intact, but the file is not byte for byte the PDF
 *   the exam drew from it (pages changed, or the file was re-saved).
 * - "ok": the file is exactly what the exam produced.
 * Pass the jsPDF class to run the byte check; without it only the data is checked.
 */
export async function verifySubmissionPdf(bytes, JsPDF) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const data = extractSubmissionPdf(view);
  const result = await verifySubmissionObject(data);
  if (!result.ok) return { ...result, status: "tampered", data };
  if (!JsPDF || !data.render) return { ...result, status: "ok", data, pagesChecked: false };
  const rebuilt = new Uint8Array(buildReportPdf(data, JsPDF, data.render));
  const same = rebuilt.length === view.length && rebuilt.every((byte, i) => byte === view[i]);
  return { ...result, ok: same, status: same ? "ok" : "edited", data, pagesChecked: true };
}

/** First 16 hex characters of the hash, grouped, for the printed seal. */
function fingerprint(hash) {
  return String(hash).slice(0, 16).toUpperCase().replace(/(.{4})(?!$)/g, "$1 ");
}

/**
 * Build the report. Returns an ArrayBuffer.
 * The same sealed data and options always give the same bytes, so the verify
 * tool can rebuild the file and spot any edit. options.title and options.course
 * label the header; options.timeZone defaults to the browser's own zone.
 */
export function buildReportPdf(sealed, JsPDF, options = {}) {
  const payload = sealed.payload;
  const timeZone = options.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const render = { title: options.title || "", course: options.course || "", timeZone };
  const doc = new JsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  // Fixed date and file id instead of "now" and a random id, so a rebuild matches byte for byte.
  doc.setCreationDate(new Date(payload.submittedAt));
  doc.setFileId(String(sealed.hash).slice(0, 32).toUpperCase());
  doc.setProperties({
    title: pdfSafe(`Lab exam report - ${payload.student.reg} - Q${payload.question.id}`),
    subject: pdfSafe(render.title || "Lab exam submission"),
    author: pdfSafe(payload.student.name),
    creator: "Lab Exam Console",
  });
  doc.addMetadata(embedSubmission(sealed, render), "https://lab-exam-console.invalid/submission#");

  let y = MARGIN;

  function color(rgb, kind = "text") {
    if (kind === "text") doc.setTextColor(...rgb);
    else if (kind === "fill") doc.setFillColor(...rgb);
    else doc.setDrawColor(...rgb);
  }
  function font(family, style, size) {
    doc.setFont(family, style);
    doc.setFontSize(size);
  }
  function lineHeight(size, factor = 1.4) {
    return size * PT_TO_MM * factor;
  }
  function newPage() {
    doc.addPage();
    y = MARGIN;
  }
  function ensure(height) {
    if (y + height > BOTTOM) newPage();
  }

  function heading(text) {
    ensure(16);
    y += 4;
    font("helvetica", "bold", 12.5);
    color(BRAND);
    doc.text(pdfSafe(text), MARGIN, y + 4);
    y += 6.5;
    color(LINE, "draw");
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 4;
  }

  function paragraph(text, { size = 10, style = "normal", rgb = INK, gap = 2, indent = 0 } = {}) {
    font("helvetica", style, size);
    color(rgb);
    const lh = lineHeight(size);
    const lines = doc.splitTextToSize(pdfSafe(text), CONTENT_W - indent);
    for (const line of lines) {
      ensure(lh);
      doc.text(line, MARGIN + indent, y + lh * 0.75);
      y += lh;
    }
    y += gap;
  }

  function codeBlock(text, { numbered = false, empty = "(empty)" } = {}) {
    const size = 8.5;
    const lh = lineHeight(size, 1.35);
    const gutter = numbered ? 9 : 0;
    font("courier", "normal", size);
    const source = pdfSafe(text).replace(/\n$/, "");
    const rows = [];
    (source ? source.split("\n") : [empty]).forEach((raw, index) => {
      const wrapped = doc.splitTextToSize(raw || " ", CONTENT_W - 6 - gutter);
      wrapped.forEach((part, wrapIndex) => rows.push({ part, number: wrapIndex === 0 ? index + 1 : null }));
    });
    ensure(lh + 4);
    y += 1;
    for (const row of rows) {
      ensure(lh);
      color(SOFT, "fill");
      doc.rect(MARGIN, y, CONTENT_W, lh, "F");
      if (numbered && row.number != null && source) {
        color(MUTED);
        doc.text(String(row.number), MARGIN + gutter - 1, y + lh * 0.75, { align: "right" });
      }
      color(INK);
      doc.text(row.part, MARGIN + 3 + gutter, y + lh * 0.75);
      y += lh;
    }
    y += 4;
  }

  function details(rows) {
    const size = 10;
    const lh = lineHeight(size, 1.5);
    for (const [label, value] of rows) {
      ensure(lh);
      font("helvetica", "normal", size);
      color(MUTED);
      doc.text(pdfSafe(label), MARGIN, y + lh * 0.7);
      font("helvetica", "bold", size);
      color(INK);
      doc.text(doc.splitTextToSize(pdfSafe(value), CONTENT_W - 42)[0] || "", MARGIN + 42, y + lh * 0.7);
      y += lh;
    }
  }

  // Header band
  color(BRAND, "fill");
  doc.rect(0, 0, PAGE_W, 30, "F");
  font("helvetica", "bold", 18);
  color([255, 255, 255]);
  doc.text("Lab Exam Report", MARGIN, 14);
  font("helvetica", "normal", 10);
  color([185, 200, 220]);
  doc.text(pdfSafe([render.title, render.course].filter(Boolean).join("  |  ") || "Submission"), MARGIN, 21.5);
  y = 38;

  // Student details beside the seal
  const boxW = 72;
  const boxX = PAGE_W - MARGIN - boxW;
  const top = y;
  const started = Date.parse(payload.startedAt);
  const submitted = Date.parse(payload.submittedAt);
  const detailRows = [
    ["Name", payload.student.name],
    ["Email", payload.student.email ? `${payload.student.email}${payload.student.emailVerified ? "  (Google sign-in)" : ""}` : "-"],
    ["Register number", payload.student.reg],
    ["Question number", `Q${payload.question.id}`],
    ["Started", formatWhen(payload.startedAt, timeZone)],
    ["Submitted", formatWhen(payload.submittedAt, timeZone)],
    ["Time taken", Number.isFinite(started) && Number.isFinite(submitted) ? formatDuration(submitted - started) : ""],
  ];
  const size = 10;
  const lh = lineHeight(size, 1.5);
  detailRows.forEach(([label, value], index) => {
    const rowY = top + index * lh;
    font("helvetica", "normal", size);
    color(MUTED);
    doc.text(label, MARGIN, rowY + lh * 0.7);
    font("helvetica", "bold", size);
    color(INK);
    const width = boxX - (MARGIN + 34) - 4;
    doc.text(doc.splitTextToSize(pdfSafe(value), width)[0] || "", MARGIN + 34, rowY + lh * 0.7);
  });
  // The seal: a stamp mark with the receipt and fingerprint of the sealed data.
  const boxH = 38;
  color(SOFT, "fill");
  color(BRAND, "draw");
  doc.setLineWidth(0.6);
  doc.roundedRect(boxX, top, boxW, boxH, 2, 2, "FD");
  doc.setLineWidth(0.2);
  doc.roundedRect(boxX + 1.2, top + 1.2, boxW - 2.4, boxH - 2.4, 1.5, 1.5, "S");
  const cx = boxX + 15;
  const cy = top + boxH / 2;
  doc.setLineWidth(0.8);
  doc.circle(cx, cy, 11, "S");
  doc.setLineWidth(0.25);
  doc.circle(cx, cy, 9.3, "S");
  color(BRAND);
  font("helvetica", "bold", 4.6);
  doc.text("LAB EXAM", cx, cy - 4, { align: "center" });
  font("helvetica", "bold", 7.5);
  doc.text("SEALED", cx, cy + 1.2, { align: "center" });
  font("helvetica", "bold", 4.6);
  const sealDay = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone })
    .format(new Date(payload.submittedAt)).toUpperCase();
  doc.text(pdfSafe(sealDay), cx, cy + 5.4, { align: "center" });
  const tx = boxX + 30;
  font("helvetica", "bold", 7);
  doc.text("SUBMISSION SEAL", tx, top + 8);
  font("courier", "bold", 12.5);
  color(INK);
  doc.text(pdfSafe(sealed.receipt), tx, top + 15.5);
  font("helvetica", "normal", 6.3);
  color(MUTED);
  doc.text("Fingerprint", tx, top + 21.5);
  font("courier", "normal", 7);
  color(INK);
  doc.text(fingerprint(sealed.hash), tx, top + 25.5);
  font("helvetica", "normal", 6.3);
  color(MUTED);
  doc.text("Any edit to this file is detected.", tx, top + 31.5);
  y = Math.max(top + detailRows.length * lh, top + boxH) + 4;

  // Diagrams. Each one moves to a new page only when it does not fit below the last.
  const HEAD_H = 22;
  for (const diagram of payload.diagrams || []) {
    let size = null;
    if (isPngDataUri(diagram.png)) {
      const props = doc.getImageProperties(diagram.png);
      const pageMax = BOTTOM - MARGIN - HEAD_H;
      let w = CONTENT_W;
      let h = (props.height / props.width) * w;
      if (h > pageMax) {
        h = pageMax;
        w = (props.width / props.height) * h;
      }
      // Small diagrams are not blown up past their natural size (96 dpi).
      const natural = props.width * 25.4 / 96;
      if (w > natural) {
        h *= natural / w;
        w = natural;
      }
      size = { w, h };
    }
    if (y + HEAD_H + (size ? size.h : 12) > BOTTOM) newPage();
    heading(`Part A - Diagram ${diagram.index}`);
    paragraph(diagram.cells
      ? `${diagram.cells} ${diagram.cells === 1 ? "element" : "elements"} drawn (a rough effort indicator, not a grade).`
      : "This diagram was empty when submitted.", { size: 9, rgb: diagram.cells ? MUTED : AMBER });
    if (size) {
      const { w, h } = size;
      const x = MARGIN + (CONTENT_W - w) / 2;
      color(LINE, "draw");
      doc.rect(x - 0.5, y - 0.5, w + 1, h + 1);
      doc.addImage(diagram.png, "PNG", x, y, w, h);
      y += h + 4;
    } else {
      paragraph(`The image could not be exported (${diagram.pngError || "no image"}). The diagram data is stored inside this PDF and can be checked with the teacher tools.`, { size: 9, rgb: AMBER });
    }
  }

  // Python
  ensure(40);
  heading("Part B - Python program");
  codeBlock(payload.code, { numbered: true });
  heading("Last program run");
  paragraph(payload.runCount
    ? `The program was run ${payload.runCount} ${payload.runCount === 1 ? "time" : "times"} (each answered input counts as a run).`
    : "The program was never run.", { size: 9, rgb: MUTED });
  codeBlock(payload.lastTranscript, { empty: "(no output recorded)" });

  // Conduct: keep the heading, summary, and first table rows together.
  ensure(48);
  heading("Exam conduct");
  details([
    ["Incidents", `${payload.incidents}${payload.lockCount ? `  (session locked ${payload.lockCount} ${payload.lockCount === 1 ? "time" : "times"})` : ""}`],
    ["Recorded events", `${payload.majorEvents} major, ${payload.minorEvents} minor`],
    ...(payload.previousReceipts?.length
      ? [["Reopened", `${payload.previousReceipts.length} ${payload.previousReceipts.length === 1 ? "time" : "times"} by the invigilator; replaces ${payload.previousReceipts.join(", ")}`]]
      : []),
    ...(payload.seb ? [["Browser", "Safe Exam Browser"]] : []),
  ]);
  y += 2;
  const events = payload.eventLog || [];
  if (!events.length) {
    paragraph("No events were recorded.", { size: 9, rgb: MUTED });
  } else {
    const cols = [
      { label: "Time", x: MARGIN + 2, w: 24 },
      { label: "Into exam", x: MARGIN + 28, w: 18 },
      { label: "Event", x: MARGIN + 48, w: 44 },
      { label: "Detail", x: MARGIN + 94, w: 58 },
      { label: "Counted", x: MARGIN + 156, w: 14 },
    ];
    const rowSize = 8.5;
    const rowLh = lineHeight(rowSize, 1.35);
    const headerRow = () => {
      ensure(rowLh + 2);
      color([232, 236, 241], "fill");
      doc.rect(MARGIN, y, CONTENT_W, rowLh + 1.5, "F");
      font("helvetica", "bold", rowSize);
      color(MUTED);
      cols.forEach((col) => doc.text(col.label, col.x, y + rowLh * 0.8));
      y += rowLh + 1.5;
    };
    headerRow();
    events.forEach((event, index) => {
      font("helvetica", "normal", rowSize);
      const detail = doc.splitTextToSize(pdfSafe(event.detail), cols[3].w);
      const height = Math.max(1, detail.length) * rowLh + 1.5;
      if (y + height > BOTTOM) {
        newPage();
        headerRow();
        font("helvetica", "normal", rowSize);
      }
      if (index % 2) {
        color(SOFT, "fill");
        doc.rect(MARGIN, y, CONTENT_W, height, "F");
      }
      color(INK);
      const baseline = y + rowLh * 0.8;
      doc.text(formatClockTime(event.iso, timeZone), cols[0].x, baseline);
      doc.text(sinceStart(event.ms), cols[1].x, baseline);
      doc.text(pdfSafe(EVENT_LABELS[event.type] || event.type), cols[2].x, baseline);
      doc.text(detail, cols[3].x, baseline);
      doc.text(event.scored ? "Yes" : "No", cols[4].x, baseline);
      y += height;
    });
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    color(LINE, "draw");
    doc.setLineWidth(0.3);
    doc.line(MARGIN, PAGE_H - 12, PAGE_W - MARGIN, PAGE_H - 12);
    font("helvetica", "normal", 8);
    color(MUTED);
    doc.text(pdfSafe(`${payload.student.name}  |  ${payload.student.reg}  |  Sealed, receipt ${sealed.receipt}`), MARGIN, PAGE_H - 7);
    doc.text(`Page ${page} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 7, { align: "right" });
  }

  return doc.output("arraybuffer");
}

/**
 * Verify a downloaded report: a .pdf, or the .json written when the PDF could
 * not be made (data only, no pages to compare).
 */
export async function verifyReportFile(bytes, filename, JsPDF) {
  if (/\.json$/i.test(filename)) {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    const result = await verifySubmissionObject(data);
    return { ...result, status: result.ok ? "ok" : "tampered", data, pagesChecked: false };
  }
  return verifySubmissionPdf(bytes, JsPDF);
}
