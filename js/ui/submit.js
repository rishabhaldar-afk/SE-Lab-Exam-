import { canonicalStringify, createPayload, reportFilename, sealSubmission } from "../core/report.js";
import { buildReportPdf, bytesToBase64, formatWhen } from "../core/report-pdf.js";
import { selectTranscript } from "../core/py-session.js";
import { el } from "./dom.js";

/**
 * Seal the submission and build the PDF report. If the PDF library is missing
 * or fails, the report is the sealed JSON instead, so no work is lost.
 * `report` is a data URI so it can be stored and downloaded again.
 */
export async function buildSubmission(input) {
  const payload = createPayload({
    ...input,
    lastTranscript: input.lastTranscript || selectTranscript(input.recentRuns || []),
  });
  const sealed = await sealSubmission(payload);
  const base = reportFilename(input.reg, input.name, input.questionId);
  try {
    const JsPDF = window.jspdf?.jsPDF;
    if (!JsPDF) throw new Error("jsPDF did not load");
    const pdf = buildReportPdf(sealed, JsPDF, { title: input.examTitle, course: input.course });
    return {
      report: `data:application/pdf;base64,${bytesToBase64(new Uint8Array(pdf))}`,
      filename: base,
      receipt: sealed.receipt,
      sealed,
      pdfError: null,
    };
  } catch (error) {
    const json = canonicalStringify({ hash: sealed.hash, payload: sealed.payload, receipt: sealed.receipt });
    return {
      report: `data:application/json;base64,${bytesToBase64(new TextEncoder().encode(json))}`,
      filename: base.replace(/\.pdf$/, ".json"),
      receipt: sealed.receipt,
      sealed,
      pdfError: String(error?.message || error),
    };
  }
}

function dataUriToBlob(dataUri) {
  const [head, body] = String(dataUri).split(",", 2);
  const type = head.slice(5).replace(/;base64$/, "");
  const binary = atob(body || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Synchronous, so a click on "Download report again" still counts as the user's gesture. */
export function downloadReport(filename, dataUri) {
  const url = URL.createObjectURL(dataUriToBlob(dataUri));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function mountReceipt(parent, { receipt, details = {}, onDownload, onSignOut = null }) {
  const button = el("button", { type: "button", class: "primary block" }, ["Download report again"]);
  button.addEventListener("click", onDownload);
  const rows = [
    ["Name", details.name],
    ["Email", details.email],
    ["Register number", details.reg],
    ["Question", details.questionId ? `Q${details.questionId}` : ""],
    ["Submitted", details.submittedAt ? formatWhen(details.submittedAt) : ""],
  ].filter(([, value]) => value);
  parent.replaceChildren(el("main", { class: "gate" }, [
    el("section", { class: "card message-card receipt-card" }, [
      el("div", { class: "status-icon is-ok", "aria-hidden": "true" }, ["✓"]),
      el("h1", {}, ["Exam submitted"]),
      el("p", { class: "muted" }, ["Write this receipt code on the attendance sheet and show it to the invigilator. Editing is closed."]),
      el("p", { class: "eyebrow" }, ["Receipt"]),
      el("p", { class: "receipt-code" }, [receipt || ""]),
      details.previousReceipts?.length
        ? el("p", { class: "receipt-note" }, [`This receipt replaces ${details.previousReceipts.join(", ")}. Cross out the old code on the attendance sheet and write this one.`])
        : null,
      rows.length ? el("dl", { class: "receipt-meta" }, rows.flatMap(([term, value]) => [el("dt", {}, [term]), el("dd", {}, [value])])) : null,
      button,
      onSignOut
        ? el("button", { type: "button", class: "block signout", onclick: onSignOut }, ["Sign out of Google on this computer"])
        : null,
      el("p", { class: "receipt-note" }, ["Upload the downloaded PDF to the Google Form exactly as it is. Do not open it in an editor or save it again: the file is sealed, and any change is detected."]),
      el("p", { class: "field-hint center" }, ["If the PDF report did not download, use this button."]),
    ]),
    el("footer", { class: "foot" }, [
      el("button", { type: "button", class: "link", id: "invigilator-link" }, ["Invigilator"]),
    ]),
  ]));
}
