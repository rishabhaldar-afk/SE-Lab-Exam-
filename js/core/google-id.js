/**
 * Google sign-in helpers. DOM-free.
 *
 * After the student picks an account in Google's chooser, the page gets a
 * short-lived access token and asks Google's userinfo endpoint who it belongs
 * to. The answer comes from Google over HTTPS, so the page does not have to
 * trust anything the browser holds. The token is not stored.
 */

const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/** Check the claims the page relies on. Returns { name, email } or { error }. */
export function identityFromClaims(claims, { domain } = {}) {
  if (!claims || typeof claims !== "object") return { error: "Google sign-in failed. Try again." };
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

/** Ask Google who an access token belongs to. Returns { name, email } or { error }. */
export async function fetchGoogleIdentity(accessToken, { domain, fetchImpl = globalThis.fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch {
    return { error: "Could not reach Google. Check the internet connection and try again." };
  }
  if (!response.ok) return { error: "Google sign-in could not be confirmed. Try again." };
  return identityFromClaims(await response.json().catch(() => null), { domain });
}
