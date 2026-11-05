/** Versioned session save/restore. Pass any getItem/setItem backend. */

export const STORAGE_VERSION = 1;
export const FORCE_KEY = "lab-exam-console:forces";

export function sessionKey(reg) {
  return `lab-exam-console:v1:${reg}`;
}

export function serializeSession(session) {
  return JSON.stringify({ v: STORAGE_VERSION, session });
}

export function parseSession(raw) {
  if (!raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Saved session is unreadable");
  }
  if (!data || data.v !== STORAGE_VERSION || !data.session || typeof data.session !== "object") {
    throw new Error("Unsupported saved session");
  }
  return data.session;
}

export function remainingMs(startedAt, now, durationMin, closesAt, bonusMs = 0) {
  const durationMs = Number(durationMin) * 60 * 1000 + Number(bonusMs || 0);
  let end = Number(startedAt) + durationMs;
  if (closesAt != null && closesAt !== "") {
    const close = typeof closesAt === "number" ? closesAt : Date.parse(closesAt);
    if (!Number.isNaN(close)) end = Math.min(end, close);
  }
  return Math.max(0, end - now);
}

export function formatClock(ms) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function createMemoryBackend(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

export function createStore(backend) {
  return {
    load(reg) {
      return parseSession(backend.getItem(sessionKey(reg)));
    },
    save(reg, session) {
      const full = serializeSession(session);
      try {
        backend.setItem(sessionKey(reg), full);
        return "full";
      } catch {
        const slim = { ...session, reportPdf: null };
        if (slim.submission?.diagrams) {
          slim.submission = {
            ...slim.submission,
            diagrams: slim.submission.diagrams.map((diagram) => ({ ...diagram, png: null, pngStripped: true })),
          };
        }
        backend.setItem(sessionKey(reg), serializeSession(slim));
        return "slim";
      }
    },
    loadForces() {
      const raw = backend.getItem(FORCE_KEY);
      if (!raw) return {};
      try {
        const data = JSON.parse(raw);
        if (!data || data.v !== 1 || typeof data.map !== "object" || data.map == null) return {};
        return data.map;
      } catch {
        return {};
      }
    },
    saveForces(map) {
      backend.setItem(FORCE_KEY, JSON.stringify({ v: 1, map }));
    },
  };
}

export function freshSession({ name, email = "", reg, questionId, now }) {
  return {
    v: STORAGE_VERSION,
    name,
    email,
    reg,
    questionId,
    startedAt: now,
    bonusMs: 0,
    code: `# Q${questionId}\n`,
    diagrams: ["", ""],
    fontSize: 15,
    violations: 0,
    majorEvents: 0,
    minorEvents: 0,
    lockCount: 0,
    locked: false,
    eventLog: [],
    runs: [],
    runCount: 0,
    submitted: false,
    submittedAt: null,
    receipt: null,
    reportPdf: null,
    toasted10: false,
    toasted1: false,
    inputs: [],
  };
}
