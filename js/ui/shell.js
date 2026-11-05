import { countDiagramCells, diagramLooksEmpty } from "../core/report.js";
import { formatClock, remainingMs } from "../core/storage.js";
import { el } from "./dom.js";
import { mountPython } from "./python-tab.js";
import { mountUml } from "./uml-tab.js";

function stat(label, value) {
  return el("div", { class: "stat" }, [el("span", { class: "stat-label" }, [label]), value]);
}

export function mountShell(parent, opts) {
  const session = opts.session;
  let stopped = false;
  let violationCount = session.violations || 0;
  const max = opts.config.MAX_VIOLATIONS;

  const name = el("span", { class: "who-name" });
  name.textContent = session.name;
  const reg = el("span", { class: "who-reg" });
  reg.textContent = session.reg;
  const qLabel = el("span", { class: "q-badge", title: "Question number from the paper" }, [`Q${session.questionId}`]);
  const clock = el("span", { class: "stat-value clock", role: "timer" });
  const saved = el("span", { class: "saved" }, ["Not saved yet"]);
  const violations = el("span", { class: "stat-value violations" });
  const submitBtn = el("button", { type: "button", class: "submit" }, ["Submit exam"]);

  const umlPanel = el("section", { class: "tab-panel", role: "tabpanel", id: "panel-uml" });
  const pyPanel = el("section", { class: "tab-panel is-inactive", role: "tabpanel", id: "panel-python" });
  const umlTab = el("button", { type: "button", role: "tab", class: "tab is-on", "aria-selected": "true", "aria-controls": "panel-uml" }, [
    el("span", { class: "tab-num" }, ["A"]), "UML Diagrams",
  ]);
  const pyTab = el("button", { type: "button", role: "tab", class: "tab", "aria-selected": "false", "aria-controls": "panel-python" }, [
    el("span", { class: "tab-num" }, ["B"]), "Python Program",
  ]);
  umlTab.addEventListener("click", () => selectTab(0));
  pyTab.addEventListener("click", () => selectTab(1));

  function selectTab(index) {
    umlPanel.classList.toggle("is-inactive", index !== 0);
    pyPanel.classList.toggle("is-inactive", index !== 1);
    umlTab.classList.toggle("is-on", index === 0);
    pyTab.classList.toggle("is-on", index === 1);
    umlTab.setAttribute("aria-selected", index === 0 ? "true" : "false");
    pyTab.setAttribute("aria-selected", index === 1 ? "true" : "false");
    if (index === 0) uml.relayout();
    if (index === 1) python.refresh();
  }

  const overlay = el("div", { class: "overlay" });
  overlay.hidden = true;
  const modal = el("div", { class: "modal-back" });
  modal.hidden = true;
  const examRoot = el("div", { class: "exam-root", id: "exam-root" });
  examRoot.append(
    el("header", { class: "topbar" }, [
      el("div", { class: "brand" }, [el("strong", {}, [opts.config.EXAM_TITLE]), el("span", {}, [opts.config.COURSE])]),
      el("span", { class: "divider", "aria-hidden": "true" }),
      el("div", { class: "who" }, [name, reg]),
      qLabel,
      el("span", { class: "spacer" }),
      saved,
      stat("Incidents", violations),
      stat("Time left", clock),
      submitBtn,
    ]),
    el("div", { class: "tabbar", role: "tablist" }, [
      umlTab,
      pyTab,
      el("span", { class: "spacer" }),
      el("span", { class: "tabbar-note" }, ["Answer the question on your paper."]),
    ]),
    el("div", { class: "panels" }, [umlPanel, pyPanel]),
  );
  parent.replaceChildren(el("div", { class: "shell" }, [examRoot, overlay, modal]));

  const uml = mountUml(umlPanel, {
    origin: opts.config.DRAWIO_ORIGIN,
    xmls: session.diagrams,
    onDirty: () => opts.onDirty(),
    onUnavailable: (detail) => opts.onEvent("UML_EDITOR_UNAVAILABLE", detail),
  });
  const python = mountPython(pyPanel, {
    code: session.code,
    fontSize: session.fontSize,
    inputs: session.inputs,
    runs: session.runs,
    runCount: session.runCount,
    runTimeoutMs: opts.config.RUN_TIMEOUT_MS,
    outputLimit: opts.config.OUTPUT_LIMIT_BYTES,
    onDirty: () => opts.onDirty(),
    onRuns: () => opts.onDirty(),
    onToast: (message) => opts.onToast(message),
    onPasteBlocked: () => opts.onEvent("PASTE_BLOCKED", "python-editor"),
    onDropBlocked: () => opts.onEvent("DROP_BLOCKED", "python-editor"),
  });

  function paintClock(left) {
    clock.textContent = formatClock(left);
    clock.classList.toggle("is-amber", left <= 10 * 60 * 1000 && left > 2 * 60 * 1000);
    clock.classList.toggle("is-red", left <= 2 * 60 * 1000);
  }

  function tick() {
    if (stopped) return;
    const left = remainingMs(session.startedAt, Date.now(), opts.config.EXAM_DURATION_MIN, opts.config.EXAM_CLOSES_AT, session.bonusMs || 0);
    paintClock(left);
    if (left <= 10 * 60 * 1000 && !session.toasted10) {
      session.toasted10 = true;
      opts.onToast("10 minutes remaining");
    }
    if (left <= 60 * 1000 && !session.toasted1) {
      session.toasted1 = true;
      opts.onToast("1 minute remaining");
    }
    if (left <= 0) {
      stopped = true;
      clearInterval(timer);
      opts.onTimeUp();
    }
  }
  const timer = setInterval(tick, 250);
  tick();
  paintViolations(violationCount);

  function paintViolations(count) {
    violationCount = count;
    violations.textContent = `${count}/${max}`;
    violations.classList.toggle("is-warn", count > 0);
  }

  submitBtn.addEventListener("click", () => openModal());

  // What the student is about to hand in. Warnings do not block submission.
  function checklist() {
    const xml = uml.getXml();
    const items = [0, 1].map((index) => {
      const cells = countDiagramCells(xml[index]);
      return diagramLooksEmpty(xml[index])
        ? { warn: true, text: `Diagram ${index + 1} is empty` }
        : { warn: false, text: `Diagram ${index + 1}: ${cells} ${cells === 1 ? "shape" : "shapes"}` };
    });
    const lines = python.getCode().split("\n").filter((line) => line.trim() && !line.trim().startsWith("#")).length;
    const runs = python.getRunCount();
    if (!lines) items.push({ warn: true, text: "The Python program has no code yet" });
    else if (!runs) items.push({ warn: true, text: `Python program: ${lines} lines, never run` });
    else items.push({ warn: false, text: `Python program: ${lines} lines, has been run` });
    return items;
  }

  function openModal() {
    if (session.submitted) return;
    const items = checklist();
    const yes = el("button", { type: "button", class: "primary" }, ["Submit now"]);
    const no = el("button", { type: "button" }, ["Keep working"]);
    yes.addEventListener("click", () => {
      modal.hidden = true;
      modal.replaceChildren();
      opts.onSubmit("button");
    });
    no.addEventListener("click", () => {
      modal.hidden = true;
      modal.replaceChildren();
    });
    modal.replaceChildren(el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "submit-title" }, [
      el("h2", { id: "submit-title" }, ["Submit your exam?"]),
      el("p", { class: "muted" }, ["You cannot edit your diagrams or code after submitting."]),
      el("ul", { class: "checklist" }, items.map((item) => el("li", { class: item.warn ? "is-warn" : "" }, [item.text]))),
      el("div", { class: "modal-actions" }, [no, yes]),
    ]));
    modal.hidden = false;
    no.focus();
  }

  function meter(count, locked) {
    return el("div", { class: `meter${locked ? " is-locked" : ""}`, "aria-hidden": "true" },
      Array.from({ length: max }, (_, index) => el("span", { class: index < count ? "is-on" : "" })));
  }

  function showOverlay(reason, locked) {
    overlay.hidden = false;
    examRoot.inert = true;
    examRoot.style.visibility = "hidden";
    const count = Math.min(violationCount, max);
    const children = [
      el("div", { class: "status-icon is-warn", "aria-hidden": "true" }, ["!"]),
      el("h2", {}, [locked ? "Session locked" : "Exam paused"]),
      el("p", {}, [reason]),
      meter(count, locked),
    ];
    if (locked) {
      children.push(el("p", { class: "muted" }, [`${count} of ${max} incidents. Ask the invigilator to unlock this session. The timer is still running.`]));
    } else {
      const button = el("button", { type: "button", class: "primary block" }, ["Return to fullscreen"]);
      button.addEventListener("click", () => opts.onReturn());
      children.push(
        el("p", { class: "muted" }, [`Incident ${count} of ${max}. At ${max} the session locks until the invigilator unlocks it. The timer keeps running.`]),
        button,
      );
    }
    overlay.replaceChildren(el("div", { class: `overlay-card${locked ? " is-locked" : ""}`, role: "alertdialog" }, children));
  }

  return {
    setViolations: paintViolations,
    setSaved(when, slim) {
      saved.classList.toggle("is-warn", !when || slim);
      if (!when) {
        saved.textContent = slim ? "Save failed" : "Not saved yet";
        return;
      }
      const stamp = when.toLocaleTimeString();
      saved.textContent = slim ? `Saved ${stamp} (without images)` : `Saved ${stamp}`;
    },
    showOverlay,
    hideOverlay() {
      overlay.hidden = true;
      overlay.replaceChildren();
      examRoot.inert = false;
      examRoot.style.visibility = "";
    },
    getCode: () => python.getCode(),
    getDiagrams: () => uml.getXml(),
    getFontSize: () => python.getFontSize(),
    getRuns: () => python.getRuns(),
    getRunCount: () => python.getRunCount(),
    getInputs: () => python.getInputs(),
    getLastTranscript: () => python.getLastTranscript(),
    exportDiagrams: () => uml.exportAll(),
    freeze() {
      stopped = true;
      clearInterval(timer);
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting…";
      python.freeze();
      modal.hidden = true;
    },
    destroy() {
      clearInterval(timer);
      python.destroy();
      uml.destroy();
    },
  };
}

export function overlayReason(type) {
  if (type === "FS_EXIT") return "Fullscreen ended.";
  if (type === "TAB_HIDDEN") return "This tab was hidden.";
  if (type === "FOCUS_LOST") return "The window lost focus.";
  if (type === "SECOND_TAB") return "The exam was opened in another tab.";
  return "A lockdown event was recorded.";
}
