/** PBKDF2 hashing for the invigilator PIN. DOM-free. Uses global WebCrypto. */

export const PBKDF2_ITERATIONS = 310000;

export function bytesToB64(bytes) {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function b64ToBytes(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToHex(bytes) {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export function timingSafeEqual(left, right) {
  const a = String(left);
  const b = String(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function pbkdf2Bits(password, salt, iterations, length) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    length,
  );
  return new Uint8Array(bits);
}

export async function hashPin(pin, options = {}) {
  const iterations = options.iterations || PBKDF2_ITERATIONS;
  const salt = options.salt || crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2Bits(String(pin), salt, iterations, 256);
  return {
    kdf: "PBKDF2-SHA256",
    iter: iterations,
    salt: bytesToB64(salt),
    hash: bytesToHex(bits),
  };
}

export async function verifyPin(pin, stored) {
  if (!stored || stored.kdf !== "PBKDF2-SHA256" || !stored.salt || !stored.hash) return false;
  const got = await hashPin(pin, {
    iterations: stored.iter,
    salt: b64ToBytes(stored.salt),
  });
  return timingSafeEqual(got.hash, stored.hash);
}
