/** Violation state machine. Inputs are events with timestamps. No DOM. */

export const MAJOR_EVENTS = ["FS_EXIT", "TAB_HIDDEN", "FOCUS_LOST", "SECOND_TAB"];
export const MINOR_EVENTS = [
  "PASTE_BLOCKED",
  "DROP_BLOCKED",
  "CONTEXTMENU",
  "DEVTOOLS_KEY",
  "PRINT_KEY",
  "RELOAD_KEY",
  "UNLOAD_ATTEMPT",
  "SEB_DETECTED",
  "UML_EDITOR_UNAVAILABLE",
  "INVIGILATOR",
];

const MAJOR = new Set(MAJOR_EVENTS);
const MERGE_MS = 1500;

export function createLockdownState({ maxViolations = 3, seb = false, examStartMs = 0 } = {}) {
  return {
    maxViolations,
    seb: !!seb,
    examStartMs,
    scoring: true,
    violations: 0,
    majorEvents: 0,
    minorEvents: 0,
    lockCount: 0,
    locked: false,
    overlay: false,
    lastMajorAt: null,
    suppressFocusUntil: 0,
    eventLog: [],
  };
}

function detailText(detail) {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  return JSON.stringify(detail);
}

function withLog(state, ts, type, detail, scored, bucket) {
  const entry = {
    iso: new Date(ts).toISOString(),
    ms: Math.max(0, ts - state.examStartMs),
    type,
    detail: detailText(detail),
    scored: !!scored,
  };
  const next = { ...state, eventLog: state.eventLog.concat([entry]) };
  if (!scored) return next;
  if (bucket === "major") return { ...next, majorEvents: state.majorEvents + 1 };
  return { ...next, minorEvents: state.minorEvents + 1 };
}

export function noteFullscreenTransition(state, ts) {
  return { ...state, suppressFocusUntil: ts + 1000 };
}

export function setScoring(state, scoring) {
  return { ...state, scoring: !!scoring };
}

export function applyEvent(state, event) {
  const ts = Number(event.ts);
  const type = event.type;
  let next = state;
  const actions = [];

  if (!state.scoring && type !== "INVIGILATOR") {
    next = withLog(state, ts, type, event.detail, false, "minor");
    return { state: next, actions: ["ignored"] };
  }

  if (type === "FOCUS_LOST" && (event.activeIsIframe || ts < state.suppressFocusUntil)) {
    next = withLog(state, ts, type, event.detail || "ignored", false, "minor");
    return { state: next, actions: ["ignore-focus"] };
  }

  if (state.seb && (type === "FS_EXIT" || type === "FOCUS_LOST")) {
    next = withLog(state, ts, type, event.detail || "seb-ignored", false, "major");
    return { state: next, actions: ["ignore-seb"] };
  }

  if (MAJOR.has(type)) {
    const merged = state.lastMajorAt != null && ts - state.lastMajorAt < MERGE_MS;
    next = withLog(state, ts, type, event.detail, true, "major");
    next = { ...next, lastMajorAt: ts, overlay: true };
    actions.push("cover");
    if (!merged) {
      const violations = next.violations + 1;
      next = { ...next, violations };
      actions.push("increment");
      if (violations >= next.maxViolations && !state.locked) {
        next = { ...next, locked: true, lockCount: state.lockCount + 1 };
        actions.push("lock");
      } else if (violations >= next.maxViolations) {
        next = { ...next, locked: true };
        actions.push("lock");
      }
    } else {
      actions.push("merged");
    }
    return { state: next, actions };
  }

  next = withLog(state, ts, type, event.detail, true, "minor");
  actions.push("log");
  return { state: next, actions };
}

/** Unlock clears the lock and the incident counter. The timer is not stored here. */
export function unlockSession(state, ts) {
  const logged = withLog(state, ts, "INVIGILATOR", "unlock", true, "minor");
  return {
    ...logged,
    locked: false,
    overlay: false,
    violations: 0,
    lastMajorAt: null,
  };
}

export function logInvigilator(state, ts, detail) {
  return applyEvent(state, { type: "INVIGILATOR", ts, detail }).state;
}

/**
 * BroadcastChannel role for the second-tab rule.
 * role is pending, owner, or blocked. The owner never yields.
 */
export function reduceTabRole(role, myId, message) {
  if (!message || message.tabId === myId || role === "blocked") {
    return { role, actions: [] };
  }
  if ((message.type === "hello" || message.type === "alive") && role === "owner") {
    return { role, actions: ["reply-busy", "foreign-tab"] };
  }
  if (message.type === "busy" && message.to === myId && role !== "owner") {
    return { role: "blocked", actions: ["block"] };
  }
  if (message.type === "hello" && role === "pending" && message.tabId < myId) {
    return { role: "blocked", actions: ["block"] };
  }
  return { role, actions: [] };
}
