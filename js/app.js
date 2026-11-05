import { CONFIG } from "../config.js";
import { isValidReg, normalizeReg } from "./core/assign.js";
import { classifyClient } from "./core/client-check.js";
import {
  applyEvent,
  createLockdownState,
  logInvigilator,
  noteFullscreenTransition,
  setScoring,
  unlockSession,
} from "./core/lockdown-core.js";
import { createStore, freshSession, remainingMs, reopenSession } from "./core/storage.js";
import { mountBlocked, mountGate, mountUnsupported, normalizeEmail, parseQuestionNumber, validateGate } from "./ui/gate.js";
import { mountInvigilator } from "./ui/invigilator.js";
import { attachHardening, startTabGuard } from "./ui/lockdown-ui.js";
import { mountShell, overlayReason } from "./ui/shell.js";
import { buildSubmission, downloadReport, mountReceipt } from "./ui/submit.js";

const root = document.querySelector("#app");
const store = createStore(window.localStorage);
const client = classifyClient({
  userAgent: navigator.userAgent,
  platform: navigator.platform,
  maxTouchPoints: navigator.maxTouchPoints || 0,
  pointerFine: window.matchMedia("(pointer: fine)").matches,
  pointerCoarse: window.matchMedia("(pointer: coarse)").matches,
});

let session = null;
let lockdown = null;
let shell = null;
let submitting = false;
let saveTimer = 0;

const inv = mountInvigilator({
  pinHash: CONFIG.INVIGILATOR_PIN_HASH,
  questionCount: CONFIG.QUESTION_COUNT,
  currentReg: () => session?.reg || "",
  onFail: () => {
    if (lockdown) lockdown = logInvigilator(lockdown, Date.now(), "pin-failed");
  },
  unlock() {
    if (!lockdown || !shell) {
      toast("No session to unlock.");
      return;
    }
    lockdown = unlockSession(lockdown, Date.now());
    shell.hideOverlay();
    shell.setViolations(0);
    persist(true);
    toast("Session unlocked.");
  },
  addMinutes(minutes) {
    // Allowed after a submit too, so time can be added before reopening.
    if (!session) {
      toast("No session on this computer.");
      return;
    }
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) {
      toast("Enter a whole number of minutes.");
      return;
    }
    session.bonusMs = (session.bonusMs || 0) + minutes * 60 * 1000;
    if (lockdown) lockdown = logInvigilator(lockdown, Date.now(), `add-minutes ${minutes}`);
    persist(true);
    toast(`Added ${minutes} minutes.`);
  },
  reopen() {
    if (!session?.submitted) {
      toast("This exam is not submitted, so there is nothing to reopen.");
      return;
    }
    const left = remainingMs(session.startedAt, Date.now(), CONFIG.EXAM_DURATION_MIN, CONFIG.EXAM_CLOSES_AT, session.bonusMs || 0);
    if (left <= 0) {
      toast("This student has no time left. Use Add minutes first, then reopen.");
      return;
    }
    // Ask for fullscreen inside this click, before anything waits.
    const fullscreen = client.seb ? Promise.resolve({ ok: true }) : requestFullscreenNow();
    const previous = session.receipt || "none";
    session = reopenSession(session);
    lockdown = noteFullscreenTransition(setScoring(restoreLockdown(session), true), Date.now());
    lockdown = logInvigilator(lockdown, Date.now(), `reopen after submit, previous receipt ${previous}`);
    submitting = false;
    inv.close();
    openShell();
    toast("Exam reopened. All work is kept, and the timer continues.");
    fullscreen.then(async (result) => {
      if (result.ok) await lockKeyboard();
      else shell?.showOverlay("Fullscreen is needed to continue.", false);
    });
  },
  forceSubmit() {
    if (!session || session.submitted) {
      toast("Nothing to submit.");
      return;
    }
    if (lockdown) lockdown = logInvigilator(lockdown, Date.now(), "force-submit");
    submit("invigilator");
  },
  forceQuestion(regValue, number) {
    const reg = normalizeReg(regValue);
    if (!isValidReg(reg, CONFIG.REGNO_PATTERN)) {
      toast("That register number is not valid.");
      return;
    }
    if (!Number.isInteger(number) || number < 1 || number > CONFIG.QUESTION_COUNT) {
      toast("Question number is out of range.");
      return;
    }
    const forces = store.loadForces();
    forces[reg] = number;
    store.saveForces(forces);
    if (lockdown) lockdown = logInvigilator(lockdown, Date.now(), `force-question ${reg} Q${number}`);
    persist(true);
    toast(`Q${number} will be recorded for ${reg} at their next sign-in. Their work is kept.`);
  },
  diagnostics() {
    const bytes = session ? JSON.stringify(session).length : 0;
    return [
      `build ${CONFIG.BUILD_ID}`,
      `config ${CONFIG.CONFIG_VERSION}`,
      `question ${session?.questionId ?? "-"}`,
      `events ${lockdown?.eventLog?.length ?? 0}`,
      `incidents ${lockdown?.violations ?? 0}`,
      `locked ${Boolean(lockdown?.locked)}`,
      `storage ${bytes} bytes`,
      navigator.userAgent,
    ].join("\n");
  },
});

const hardening = attachHardening({
  isActive: () => examLive(),
  onMinor(kind) {
    if (kind === "INVIGILATOR_CHORD") {
      inv.open();
      return;
    }
    record(kind, "keyboard");
  },
  onBack() {
    record("UNLOAD_ATTEMPT", "back");
  },
});

document.addEventListener("fullscreenchange", () => {
  if (!lockdown) return;
  lockdown = noteFullscreenTransition(lockdown, Date.now());
  if (!document.fullscreenElement) {
    unlockKeyboard();
    record("FS_EXIT", "fullscreenchange");
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") record("TAB_HIDDEN", "visibilitychange");
});

window.addEventListener("blur", () => {
  setTimeout(() => {
    record("FOCUS_LOST", "blur", { activeIsIframe: document.activeElement?.tagName === "IFRAME" });
  }, 0);
});

setInterval(() => {
  if (!examLive() || document.hasFocus() || lockdown.overlay) return;
  record("FOCUS_LOST", "poll", { activeIsIframe: document.activeElement?.tagName === "IFRAME" });
}, 1000);

function toast(message) {
  const node = document.getElementById("toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("is-on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => node.classList.remove("is-on"), 4200);
}

function examLive() {
  return Boolean(session && !session.submitted && lockdown?.scoring && shell);
}

function syncLockdown() {
  if (!session || !lockdown) return;
  session.violations = lockdown.violations;
  session.majorEvents = lockdown.majorEvents;
  session.minorEvents = lockdown.minorEvents;
  session.lockCount = lockdown.lockCount;
  session.locked = lockdown.locked;
  session.eventLog = lockdown.eventLog;
}

function captureWork() {
  if (!session || !shell) return;
  session.code = shell.getCode();
  session.diagrams = shell.getDiagrams();
  session.fontSize = shell.getFontSize();
  session.runs = shell.getRuns();
  session.runCount = shell.getRunCount();
  session.inputs = shell.getInputs();
}

function persist(immediate = false) {
  const write = () => {
    if (!session) return;
    captureWork();
    syncLockdown();
    try {
      const mode = store.save(session.reg, session);
      shell?.setSaved(new Date(), mode === "slim");
    } catch {
      shell?.setSaved(null, true);
    }
  };
  clearTimeout(saveTimer);
  if (immediate) write();
  else saveTimer = setTimeout(write, 1000);
}

function record(type, detail, extra = {}) {
  if (!examLive()) return null;
  const result = applyEvent(lockdown, { type, ts: Date.now(), detail, ...extra });
  lockdown = result.state;
  syncLockdown();
  shell.setViolations(lockdown.violations);
  if (result.actions.includes("cover")) shell.showOverlay(overlayReason(type), lockdown.locked);
  persist(result.actions.includes("lock") || result.actions.includes("increment"));
  return result;
}

function bindFooter() {
  document.querySelector("#invigilator-link")?.addEventListener("click", () => inv.open());
}

function showGate() {
  document.body.classList.remove("is-exam");
  mountGate(root, { config: CONFIG, client, onStart });
  bindFooter();
}

function showBlocked() {
  shell?.destroy();
  shell = null;
  document.body.classList.remove("is-exam");
  mountBlocked(root);
}

/**
 * Leave the receipt for the sign-in page, ready for the next student. The
 * submitted exam stays saved on this PC: signing in again with the same
 * register number shows this receipt again.
 */
function backToMainPage() {
  session = null;
  lockdown = null;
  showGate();
}

function showReceipt() {
  document.body.classList.remove("is-exam");
  mountReceipt(root, {
    receipt: session.receipt,
    details: {
      name: session.name,
      email: session.email,
      reg: session.reg,
      questionId: session.questionId,
      submittedAt: session.submittedAt,
      previousReceipts: session.previousReceipts || [],
    },
    onBack: backToMainPage,
    onDownload() {
      if (!session.reportPdf) {
        toast("The report file is no longer in this browser. Ask the invigilator.");
        return;
      }
      downloadReport(session.reportFilename, session.reportPdf);
    },
  });
  bindFooter();
}


const FILE_PROTOCOL_MESSAGE = "This page was opened as a file, so it cannot start Python. Open it through a web server (see the README) and try again.";

function requestFullscreenNow() {
  const target = document.documentElement;
  if (!target.requestFullscreen) {
    return Promise.resolve({ ok: false, error: "This browser refused fullscreen." });
  }
  const request = target.requestFullscreen({ navigationUI: "hide" }).then(() => (
    document.fullscreenElement
      ? { ok: true }
      : { ok: false, error: "Fullscreen did not start. Allow fullscreen and try again." }
  )).catch(() => ({ ok: false, error: "Fullscreen was blocked. Allow fullscreen for this page and try again." }));
  // Some embedded or policy-managed browsers never settle the promise. Do not leave the button dead.
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve(document.fullscreenElement
      ? { ok: true }
      : { ok: false, error: "Fullscreen did not start. Open the exam in desktop Chrome or Edge and try again." }), 5000);
  });
  return Promise.race([request, timeout]);
}

async function lockKeyboard() {
  if (!navigator.keyboard?.lock) return;
  try {
    await navigator.keyboard.lock(["Escape"]);
  } catch {
    /* Keyboard Lock is best-effort and missing in Firefox. */
  }
}

function unlockKeyboard() {
  try {
    navigator.keyboard?.unlock?.();
  } catch {
    /* ignore */
  }
}

async function leaveFullscreen() {
  unlockKeyboard();
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {
      /* ignore */
    }
  }
}

function restoreLockdown(saved) {
  const state = createLockdownState({
    maxViolations: CONFIG.MAX_VIOLATIONS,
    seb: client.seb,
    examStartMs: saved.startedAt,
  });
  return {
    ...state,
    violations: saved.violations || 0,
    majorEvents: saved.majorEvents || 0,
    minorEvents: saved.minorEvents || 0,
    lockCount: saved.lockCount || 0,
    locked: Boolean(saved.locked),
    overlay: Boolean(saved.locked),
    eventLog: Array.isArray(saved.eventLog) ? saved.eventLog : [],
  };
}

async function onStart(fields) {
  const problem = validateGate(fields, CONFIG);
  if (problem) return { error: problem };
  const reg = normalizeReg(fields.reg);
  const name = fields.name.trim();
  const email = normalizeEmail(fields.email);
  let existing = null;
  try {
    existing = store.load(reg);
  } catch {
    return { error: "The saved session could not be read. Call the invigilator." };
  }
  if (CONFIG.GOOGLE_CLIENT_ID && existing?.email && existing.email !== email) {
    return { error: `Register number ${reg} was started on this computer with a different Google account. Call the invigilator.` };
  }
  if (existing?.submitted) {
    session = existing;
    // Not scoring, but present so invigilator actions on the receipt screen are logged.
    lockdown = setScoring(restoreLockdown(session), false);
    showReceipt();
    return { ok: true };
  }
  if (CONFIG.EXAM_CLOSES_AT && Date.parse(CONFIG.EXAM_CLOSES_AT) <= Date.now() && !existing) {
    return { error: "The exam is closed." };
  }

  if (!client.seb) {
    const fullscreen = await requestFullscreenNow();
    if (!fullscreen.ok) return fullscreen;
    await lockKeyboard();
  }

  // The question is on paper. The number typed at the first sign-in is kept on
  // resume; an invigilator override replaces it without touching the work.
  const forced = Number(store.loadForces()[reg]);
  let questionId = parseQuestionNumber(fields.question, CONFIG.QUESTION_COUNT);
  if (forced >= 1 && forced <= CONFIG.QUESTION_COUNT) questionId = forced;
  else if (existing?.questionId) questionId = existing.questionId;

  session = existing
    ? { ...existing, questionId }
    : freshSession({ name, email, reg, questionId, now: Date.now() });
  // Sessions saved before the email field existed pick it up on resume.
  if (!session.email) session.email = email;
  if (CONFIG.GOOGLE_CLIENT_ID) session.emailVerified = true;

  lockdown = restoreLockdown(session);
  if (client.seb && !lockdown.eventLog.some((entry) => entry.type === "SEB_DETECTED")) {
    lockdown = applyEvent(lockdown, { type: "SEB_DETECTED", ts: Date.now(), detail: "userAgent" }).state;
  }
  lockdown = noteFullscreenTransition(lockdown, Date.now());
  openShell();
  if (existing) toast("Resuming your saved session.");
  return { ok: true };
}

function openShell() {
  document.body.classList.add("is-exam");
  shell = mountShell(root, {
    config: CONFIG,
    session,
    onDirty: () => persist(false),
    onToast: toast,
    onEvent: record,
    onReturn: returnToExam,
    onSubmit: (reason) => submit(reason),
    onTimeUp: () => queueMicrotask(() => submit("timer")),
  });
  hardening.armHistory();
  shell.setViolations(lockdown.violations);
  if (lockdown.locked) shell.showOverlay("This session is locked.", true);
  persist(true);
}

async function returnToExam() {
  if (!lockdown || !shell) return;
  lockdown = noteFullscreenTransition(lockdown, Date.now());
  try {
    if (!document.fullscreenElement && !client.seb) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    }
    await lockKeyboard();
  } catch {
    toast("Fullscreen was blocked. Try again.");
    return;
  }
  if (!document.fullscreenElement && !client.seb) {
    toast("Fullscreen did not start.");
    return;
  }
  lockdown = { ...lockdown, overlay: false };
  shell.hideOverlay();
  persist(true);
}

async function submit(reason) {
  if (!session || session.submitted || submitting || !shell) return;
  submitting = true;
  lockdown = setScoring(lockdown, false);
  captureWork();
  syncLockdown();
  shell.freeze();
  let exported;
  try {
    exported = await shell.exportDiagrams();
  } catch {
    exported = [
      { png: null, xml: session.diagrams[0] || "", pngError: "export-failed" },
      { png: null, xml: session.diagrams[1] || "", pngError: "export-failed" },
    ];
  }
  const built = await buildSubmission({
    buildId: CONFIG.BUILD_ID,
    configVersion: CONFIG.CONFIG_VERSION,
    examTitle: CONFIG.EXAM_TITLE,
    course: CONFIG.COURSE,
    name: session.name,
    email: session.email || "",
    emailVerified: Boolean(session.emailVerified),
    reg: session.reg,
    questionId: session.questionId,
    previousReceipts: session.previousReceipts || [],
    startedAt: session.startedAt,
    submittedAt: Date.now(),
    code: session.code,
    runCount: session.runCount || 0,
    recentRuns: session.runs || [],
    lastTranscript: shell.getLastTranscript(),
    diagrams: (exported || []).map((item, index) => ({
      xml: item.xml || session.diagrams[index] || "",
      png: item.png,
      pngError: item.pngError,
    })),
    incidents: lockdown.violations,
    majorEvents: lockdown.majorEvents,
    minorEvents: lockdown.minorEvents,
    lockCount: lockdown.lockCount,
    eventLog: lockdown.eventLog,
    userAgent: navigator.userAgent,
    seb: client.seb,
  });
  session.submitted = true;
  session.submittedAt = Date.now();
  session.receipt = built.receipt;
  session.reportPdf = built.report;
  session.reportFilename = built.filename;
  session.submission = built.sealed;
  persist(true);
  downloadReport(built.filename, built.report);
  shell.destroy();
  shell = null;
  await leaveFullscreen();
  showReceipt();
  if (built.pdfError) toast("The PDF could not be made, so the report was saved as a .json file. Show it to the invigilator.");
  else toast(reason === "timer" ? "Time is up. The exam was submitted." : "Submitted. If the PDF did not download, use the button.");
}

if (location.protocol === "file:") {
  mountUnsupported(root, FILE_PROTOCOL_MESSAGE);
} else if (!client.ok) {
  mountUnsupported(root, client.reason);
} else {
  const tabGuard = startTabGuard({
    onBlocked: showBlocked,
    onForeignTab: () => record("SECOND_TAB", "broadcast"),
  });
  if (!tabGuard.isBlocked()) showGate();
}
