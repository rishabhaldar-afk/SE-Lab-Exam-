/** Register-number helpers. DOM-free. */

export function normalizeReg(value) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

export function isValidReg(normalized, pattern) {
  if (!normalized || !pattern) return false;
  return new RegExp(pattern).test(normalized);
}
