/** Canonical submission JSON, SHA-256 receipt, and verification. The PDF layout is in report-pdf.js. */

const PNG_URI = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

export function canonicalStringify(value) {
  return stringify(value);
}

function stringify(value) {
  if (value === null) return "null";
  const kind = typeof value;
  if (kind === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite number in submission");
    return JSON.stringify(value);
  }
  if (kind === "string" || kind === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stringify(item)).join(",")}]`;
  if (kind === "object") {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stringify(value[key])}`).join(",")}}`;
  }
  throw new Error("Unsupported value in submission");
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function receiptFromHash(hex) {
  const chunk = String(hex).slice(0, 12).toUpperCase();
  return `${chunk.slice(0, 4)}-${chunk.slice(4, 8)}-${chunk.slice(8, 12)}`;
}

export function countDiagramCells(xml) {
  if (!xml || typeof xml !== "string") return 0;
  const cells = xml.match(/<mxCell\b/g);
  return Math.max(0, (cells ? cells.length : 0) - 2);
}

export function diagramLooksEmpty(xml) {
  return countDiagramCells(xml) === 0;
}

export function isPngDataUri(value) {
  return typeof value === "string" && PNG_URI.test(value);
}

export function sanitizeFilenamePart(value) {
  const cleaned = String(value ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return cleaned || "student";
}

export function reportFilename(reg, name, questionId) {
  return `${sanitizeFilenamePart(reg)}_${sanitizeFilenamePart(name)}_Q${Number(questionId)}_report.pdf`;
}

export function createPayload(input) {
  return {
    v: 1,
    buildId: input.buildId,
    configVersion: input.configVersion,
    student: { name: input.name, email: input.email || "", emailVerified: Boolean(input.emailVerified), reg: input.reg },
    // The question itself is on paper. Only the number the student entered is recorded.
    question: { id: Number(input.questionId) },
    startedAt: new Date(input.startedAt).toISOString(),
    submittedAt: new Date(input.submittedAt).toISOString(),
    code: input.code ?? "",
    runCount: input.runCount || 0,
    lastTranscript: input.lastTranscript || "",
    recentRuns: input.recentRuns || [],
    diagrams: (input.diagrams || []).map((diagram, index) => ({
      index: index + 1,
      xml: diagram.xml || "",
      png: isPngDataUri(diagram.png) ? diagram.png : null,
      pngError: diagram.pngError || null,
      cells: countDiagramCells(diagram.xml || ""),
    })),
    incidents: input.incidents || 0,
    majorEvents: input.majorEvents || 0,
    minorEvents: input.minorEvents || 0,
    lockCount: input.lockCount || 0,
    eventLog: input.eventLog || [],
    userAgent: input.userAgent || "",
    seb: !!input.seb,
  };
}

export async function sealSubmission(payload) {
  const canonical = canonicalStringify(payload);
  const hash = await sha256Hex(canonical);
  const receipt = receiptFromHash(hash);
  return { payload, hash, receipt, canonical };
}

export async function verifySubmissionObject(data) {
  const canonical = canonicalStringify(data.payload);
  const hash = await sha256Hex(canonical);
  const receipt = receiptFromHash(hash);
  const ok = timingSafe(hash, data.hash) && receipt === data.receipt;
  return { ok, hash, receipt };
}

function timingSafe(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  let diff = a.length === b.length ? 0 : 1;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
