import { verifyPin } from "../core/crypto.js";
import { el } from "./dom.js";

export function mountInvigilator(handlers) {
  let open = false;
  let authed = false;
  const root = el("div", { class: "inv-back" });
  root.hidden = true;
  document.body.append(root);

  function close() {
    open = false;
    authed = false;
    root.hidden = true;
    root.replaceChildren();
  }

  function showPin() {
    const input = el("input", { type: "password", autocomplete: "off", "aria-label": "Invigilator PIN" });
    const error = el("p", { class: "form-error" });
    error.hidden = true;
    const form = el("form", { class: "inv-card" }, [
      el("h2", {}, ["Invigilator"]),
      el("p", { class: "muted" }, ["Enter the invigilator PIN. This PIN is a deterrent, not security."]),
      input,
      error,
      el("div", { class: "modal-actions" }, [
        el("button", { type: "button", onclick: close }, ["Cancel"]),
        el("button", { type: "submit", class: "primary" }, ["Unlock panel"]),
      ]),
    ]);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const ok = await verifyPin(input.value, handlers.pinHash);
      if (!ok) {
        error.hidden = false;
        error.textContent = "Incorrect PIN";
        handlers.onFail?.();
        return;
      }
      authed = true;
      showActions();
    });
    root.replaceChildren(form);
    input.focus();
  }

  function showActions() {
    const minutes = el("input", { type: "number", min: "1", max: "120", value: "10", "aria-label": "Minutes to add" });
    const question = el("input", { type: "number", min: "1", max: String(handlers.questionCount), value: "1", "aria-label": "Question number" });
    const reg = el("input", { type: "text", value: handlers.currentReg?.() || "", "aria-label": "Register number" });
    const diag = el("pre", { class: "diag" });
    diag.hidden = true;
    const card = el("div", { class: "inv-card", role: "dialog", "aria-modal": "true" }, [
      el("h2", {}, ["Invigilator tools"]),
      el("p", { class: "muted" }, ["Every action here is written to the student's event log."]),
      el("div", { class: "inv-rows" }, [
        row("Unlock session", "Removes the lock screen and resets the incident count.", [
          action("Unlock", () => handlers.unlock()),
        ]),
        row("Add time", "Extends this student's timer.", [
          minutes, el("span", { class: "muted" }, ["min"]),
          action("Add", () => handlers.addMinutes(Number(minutes.value))),
        ]),
        row("Force submit", "Submits the exam now and downloads the report.", [
          action("Force submit", () => handlers.forceSubmit(), "danger"),
        ]),
        row("Correct question number", "Fixes a wrongly typed number at that student's next sign-in. Their work is kept.", [
          reg, el("span", { class: "muted" }, ["Q"]), question,
          action("Save", () => handlers.forceQuestion(reg.value, Number(question.value))),
        ]),
        row("Diagnostics", "Build, question, events, and storage size.", [
          action("Show", () => showDiag(diag)),
        ]),
      ]),
      diag,
      el("div", { class: "modal-actions" }, [action("Close", close)]),
    ]);
    root.replaceChildren(card);
  }

  function row(title, detail, controls) {
    return el("div", { class: "inv-row" }, [
      el("div", {}, [el("strong", {}, [title]), el("p", {}, [detail])]),
      el("div", { class: "inline" }, controls),
    ]);
  }

  function action(label, fn, tone) {
    return el("button", { type: "button", class: tone || null, onclick: () => { fn(); } }, [label]);
  }

  function showDiag(node) {
    const info = handlers.diagnostics();
    node.hidden = false;
    node.textContent = info;
  }

  function openPanel() {
    if (open) return;
    open = true;
    root.hidden = false;
    if (authed) showActions();
    else showPin();
  }

  return { open: openPanel, close, isOpen: () => open };
}
