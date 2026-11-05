/** Desktop Chrome/Edge gate. Firefox is allowed. Safari, mobile, and touch-only are not. */

export function classifyClient({
  userAgent = "",
  platform = "",
  maxTouchPoints = 0,
  pointerFine = true,
  pointerCoarse = false,
} = {}) {
  const seb = /SEB/i.test(userAgent);
  if (seb) {
    return {
      ok: true,
      seb: true,
      firefox: false,
      keyboardLockLikely: true,
      reason: "",
    };
  }

  const safari = /Safari/i.test(userAgent) && !/Chrome|Chromium|Edg|Android/i.test(userAgent);
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  const iPadDesktop = platform === "MacIntel" && maxTouchPoints > 1;
  const touchOnly = pointerCoarse && !pointerFine;

  if (safari) {
    return fail("Safari is not supported for this exam. Use desktop Chrome or Edge.");
  }
  if (mobileUa || iPadDesktop || touchOnly) {
    return fail("This exam must be taken on a desktop computer. Phones, tablets, and touch-only devices are not supported.");
  }

  const firefox = /Firefox\//i.test(userAgent);
  const chromium = /Chrome|Chromium|Edg\//i.test(userAgent);
  if (!firefox && !chromium) {
    return fail("Unsupported browser. Use desktop Chrome or Edge.");
  }
  return {
    ok: true,
    seb: false,
    firefox,
    keyboardLockLikely: chromium && !firefox,
    reason: "",
  };
}

function fail(reason) {
  return { ok: false, seb: false, firefox: false, keyboardLockLikely: false, reason };
}
