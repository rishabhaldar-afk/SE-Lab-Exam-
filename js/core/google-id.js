/**
 * Google sign-in helpers. DOM-free.
 *
 * The page reads the ID token's claims to fill in the student's name and
 * email. It does not verify the token's signature, so this proves only that
 * the student signed in through Google's button on this page, not more.
 */

export function decodeIdToken(credential) {
  const parts = String(credential ?? "").split(".");
  if (parts.length !== 3) throw new Error("Not a Google sign-in token");
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Check the claims the page relies on. Returns { name, email } or { error }. */
export function identityFromClaims(claims, { clientId, domain, nowMs = Date.now() } = {}) {
  if (!claims || typeof claims !== "object") return { error: "Google sign-in failed. Try again." };
  if (clientId && claims.aud !== clientId) return { error: "This sign-in is not for this exam. Try again." };
  if (Number(claims.exp) * 1000 <= nowMs) return { error: "Your Google sign-in expired. Sign in again." };
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    return { error: "Google has not verified this email address." };
  }
  const email = String(claims.email ?? "").trim().toLowerCase();
  if (!email) return { error: "Google did not share an email address." };
  if (domain && claims.hd !== domain) {
    return { error: `Sign in with your ${domain} account.` };
  }
  const name = String(claims.name ?? "").trim() || email.split("@")[0];
  return { name, email };
}
