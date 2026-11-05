import { reduceTabRole } from "../core/lockdown-core.js";

const OWNER_KEY = "lab-exam-console:owner";

export function startTabGuard({ onBlocked, onForeignTab }) {
  const tabId = crypto.randomUUID();
  let role = "pending";
  let channel = null;
  try {
    channel = new BroadcastChannel("lab-exam-console");
  } catch {
    channel = null;
  }

  function publish(type, extra = {}) {
    channel?.postMessage({ type, tabId, ...extra });
  }

  function readOwner() {
    try {
      return JSON.parse(localStorage.getItem(OWNER_KEY) || "null");
    } catch {
      return null;
    }
  }

  function becomeBlocked() {
    if (role === "blocked") return;
    role = "blocked";
    onBlocked();
  }

  function onChannel(event) {
    const result = reduceTabRole(role, tabId, event.data);
    role = result.role;
    if (result.actions.includes("reply-busy")) publish("busy", { to: event.data.tabId });
    if (result.actions.includes("foreign-tab")) onForeignTab?.();
    if (result.actions.includes("block")) onBlocked();
  }

  function onStorage(event) {
    if (event.key !== OWNER_KEY || role !== "owner") return;
    try {
      const next = JSON.parse(event.newValue || "null");
      if (next && next.tabId !== tabId) becomeBlocked();
    } catch {
      /* ignore broken storage */
    }
  }

  const current = readOwner();
  const now = Date.now();
  if (current && current.tabId !== tabId && now - Number(current.ts) < 4000) {
    role = "blocked";
    publish("hello");
    onBlocked();
  } else {
    localStorage.setItem(OWNER_KEY, JSON.stringify({ tabId, ts: now }));
    role = "owner";
  }

  // A reload is the same tab. Release ownership on the way out so the
  // reloaded page does not see its own heartbeat and block itself.
  function onPageHide() {
    if (role !== "owner") return;
    const owner = readOwner();
    if (owner?.tabId === tabId) localStorage.removeItem(OWNER_KEY);
  }

  channel?.addEventListener("message", onChannel);
  window.addEventListener("storage", onStorage);
  window.addEventListener("pagehide", onPageHide);
  const beat = setInterval(() => {
    if (role !== "owner") return;
    localStorage.setItem(OWNER_KEY, JSON.stringify({ tabId, ts: Date.now() }));
    publish("alive");
  }, 1000);

  return {
    isBlocked: () => role === "blocked",
    stop() {
      clearInterval(beat);
      channel?.removeEventListener("message", onChannel);
      channel?.close();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", onPageHide);
      const owner = readOwner();
      if (owner?.tabId === tabId) localStorage.removeItem(OWNER_KEY);
    },
  };
}

export function minorKey(event) {
  const key = String(event.key || "").toLowerCase();
  const ctrl = event.ctrlKey || event.metaKey;
  if (event.ctrlKey && event.altKey && event.shiftKey && key === "i") return "INVIGILATOR_CHORD";
  if (event.key === "F12") return "DEVTOOLS_KEY";
  if (ctrl && event.shiftKey && (key === "i" || key === "j" || key === "c")) return "DEVTOOLS_KEY";
  if (ctrl && !event.shiftKey && !event.altKey && key === "u") return "DEVTOOLS_KEY";
  if (ctrl && !event.altKey && key === "p") return "PRINT_KEY";
  if (event.key === "F5" || (ctrl && !event.altKey && key === "r")) return "RELOAD_KEY";
  return "";
}

export function attachHardening({ isActive, onMinor, onBack }) {
  function onKey(event) {
    const kind = minorKey(event);
    if (!kind) return;
    if (kind === "INVIGILATOR_CHORD") {
      event.preventDefault();
      onMinor("INVIGILATOR_CHORD");
      return;
    }
    if (!isActive()) return;
    event.preventDefault();
    onMinor(kind);
  }
  function onContext(event) {
    if (!isActive()) return;
    event.preventDefault();
    onMinor("CONTEXTMENU");
  }
  function onDrag(event) {
    if (!isActive()) return;
    event.preventDefault();
  }
  function onDrop(event) {
    if (!isActive()) return;
    event.preventDefault();
    onMinor("DROP_BLOCKED");
  }
  function onBeforeUnload(event) {
    if (!isActive()) return;
    event.preventDefault();
    event.returnValue = "";
    onMinor("UNLOAD_ATTEMPT");
  }
  function onPop() {
    if (!isActive()) return;
    history.pushState({ exam: 1 }, "");
    onBack();
  }
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("contextmenu", onContext, true);
  window.addEventListener("dragover", onDrag, true);
  window.addEventListener("drop", onDrop, true);
  window.addEventListener("beforeunload", onBeforeUnload);
  window.addEventListener("popstate", onPop);
  return {
    armHistory() {
      history.pushState({ exam: 1 }, "");
    },
    stop() {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("dragover", onDrag, true);
      window.removeEventListener("drop", onDrop, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("popstate", onPop);
    },
  };
}
