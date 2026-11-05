import { el } from "./dom.js";
import { isValidReg, normalizeReg } from "../core/assign.js";
import { decodeIdToken, identityFromClaims } from "../core/google-id.js";

const GIS_SRC = "https://accounts.google.com/gsi/client";
let gisLoading = null;

function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GIS_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        gisLoading = null;
        reject(new Error("Google sign-in could not load"));
      };
      document.head.append(script);
    });
  }
  return gisLoading;
}

/**
 * Google sign-in panel. Calls onChange({ name, email, credential }) after a
 * good sign-in and onChange(null) after "Use a different account".
 */
function mountGoogleSignIn(config, onChange) {
  const box = el("div", { class: "google-box" });
  const status = el("p", { class: "google-error", role: "alert" });
  status.hidden = true;
  const target = el("div", { class: "google-button" });

  function showButton() {
    box.replaceChildren(
      el("p", { class: "google-lede" }, [`Sign in with your ${config.GOOGLE_ALLOWED_DOMAIN || "Google"} account to fill in your name and email.`]),
      target,
      status,
    );
    loadGis().then(() => {
      window.google.accounts.id.initialize({
        client_id: config.GOOGLE_CLIENT_ID,
        callback: onCredential,
        hd: config.GOOGLE_ALLOWED_DOMAIN || undefined,
        auto_select: false,
        cancel_on_tap_outside: true,
        ux_mode: "popup",
      });
      window.google.accounts.id.renderButton(target, { theme: "outline", size: "large", text: "signin_with", width: 300 });
    }).catch(() => {
      status.hidden = false;
      status.textContent = "Google sign-in could not load. Check the internet connection, then reload the page.";
    });
  }

  function onCredential(response) {
    let who;
    try {
      who = identityFromClaims(decodeIdToken(response?.credential), {
        clientId: config.GOOGLE_CLIENT_ID,
        domain: config.GOOGLE_ALLOWED_DOMAIN,
      });
    } catch {
      who = { error: "Google sign-in failed. Try again." };
    }
    if (who.error) {
      status.hidden = false;
      status.textContent = who.error;
      return;
    }
    const other = el("button", { type: "button", class: "link" }, ["Use a different account"]);
    other.addEventListener("click", () => {
      window.google?.accounts?.id?.disableAutoSelect?.();
      onChange(null);
      showButton();
    });
    box.replaceChildren(el("div", { class: "google-signed" }, [
      el("span", { class: "google-mark", "aria-hidden": "true" }, ["G"]),
      el("div", {}, [el("strong", {}, [who.name]), el("span", {}, [who.email])]),
      other,
    ]));
    onChange({ name: who.name, email: who.email, credential: response.credential });
  }

  showButton();
  return box;
}

export function validateGate(fields, config) {
  if (config.GOOGLE_CLIENT_ID && !fields.googleCredential) {
    return "Sign in with your college Google account first.";
  }
  const name = String(fields.name ?? "").trim();
  if (name.length < 2 || name.length > 80 || /[\u0000-\u001F]/.test(name)) {
    return "Enter your full name.";
  }
  if (!isValidEmail(fields.email)) {
    return "Enter a valid email address.";
  }
  const reg = normalizeReg(fields.reg);
  if (!isValidReg(reg, config.REGNO_PATTERN)) {
    return "Enter a valid register number.";
  }
  if (parseQuestionNumber(fields.question, config.QUESTION_COUNT) == null) {
    return `Enter your question number (1 to ${config.QUESTION_COUNT}) from the question paper.`;
  }
  if (!fields.rules) return "Confirm that you have read the rules.";
  return "";
}

/** The question number the student copies from the paper, or null if it is not 1..max. */
export function parseQuestionNumber(value, max) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const number = Number(text);
  return number >= 1 && number <= Number(max) ? number : null;
}

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function isValidEmail(value) {
  const email = normalizeEmail(value);
  return email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function field(input, label, hint) {
  return el("div", { class: "field" }, [
    el("label", { for: input.id }, [label]),
    input,
    hint ? el("p", { class: "field-hint" }, [hint]) : null,
  ]);
}

function fact(term, value) {
  return el("div", { class: "fact" }, [el("dt", {}, [term]), el("dd", {}, [value])]);
}

function screen(children) {
  return el("main", { class: "gate" }, children);
}

export function mountGate(parent, { config, client, onStart }) {
  const error = el("p", { class: "form-error", role: "alert" });
  error.hidden = true;
  const name = el("input", { id: "student-name", type: "text", name: "name", autocomplete: "name", required: true, maxlength: "80", placeholder: "As on your ID card" });
  const email = el("input", { id: "student-email", type: "email", name: "email", autocomplete: "email", required: true, maxlength: "120", spellcheck: "false", placeholder: "name@example.com" });
  const reg = el("input", { id: "student-reg", type: "text", name: "reg", autocomplete: "off", required: true, maxlength: "32", autocapitalize: "characters", spellcheck: "false", class: "upper", placeholder: "e.g. URK22CS1001" });
  const question = el("input", { id: "question-number", type: "number", name: "question", autocomplete: "off", required: true, min: "1", max: String(config.QUESTION_COUNT), step: "1", inputmode: "numeric", placeholder: `1 to ${config.QUESTION_COUNT}` });
  const rules = el("input", { id: "rules-ok", type: "checkbox" });
  const button = el("button", { type: "submit", class: "primary block" }, ["Start exam"]);
  const note = client.firefox
    ? "Firefox can run this exam, but it cannot lock the Escape key. Chrome or Edge is preferred."
    : "Use the latest desktop Chrome or Edge. The exam opens in fullscreen.";

  // With Google sign-in the name and email come from the Google account.
  let google = null;
  const identity = config.GOOGLE_CLIENT_ID
    ? [mountGoogleSignIn(config, (who) => {
      google = who;
      error.hidden = true;
    })]
    : [field(name, "Full name"), field(email, "Email address")];

  const form = el("form", { class: "card gate-form", novalidate: true }, [
    el("h2", {}, ["Sign in"]),
    ...identity,
    field(reg, "Register number"),
    field(question, "Question number", "Copy it from your question paper."),
    el("label", { class: "check", for: "rules-ok" }, [rules, "I have read the rules and I am ready to start"]),
    error,
    button,
    el("p", { class: "field-hint center" }, ["Starting enters fullscreen and begins the timer."]),
  ]);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fields = {
      name: google ? google.name : name.value,
      email: google ? google.email : email.value,
      googleCredential: google?.credential || "",
      reg: reg.value,
      question: question.value,
      rules: rules.checked,
    };
    const problem = validateGate(fields, config);
    if (problem) {
      error.hidden = false;
      error.textContent = problem;
      return;
    }
    button.disabled = true;
    button.textContent = "Starting…";
    error.hidden = true;
    const result = await onStart(fields);
    button.disabled = false;
    button.textContent = "Start exam";
    if (result?.error) {
      error.hidden = false;
      error.textContent = result.error;
    }
  });

  parent.replaceChildren(screen([
    el("header", { class: "gate-head" }, [
      el("p", { class: "eyebrow" }, [config.COURSE]),
      el("h1", {}, [config.EXAM_TITLE]),
      el("p", { class: "lede" }, ["Your question is on the paper you were given: two UML diagrams (Part A) and one Python program (Part B)."]),
    ]),
    el("div", { class: "gate-grid" }, [
      el("section", { class: "card gate-info" }, [
        el("h2", {}, ["Before you start"]),
        el("dl", { class: "facts" }, [
          fact("Duration", `${config.EXAM_DURATION_MIN} min`),
          fact("Part A", "2 UML diagrams"),
          fact("Part B", "Python program"),
          fact("Locks after", `${config.MAX_VIOLATIONS} incidents`),
        ]),
        el("h3", {}, ["Rules"]),
        el("ol", { class: "rules" }, [
          el("li", {}, ["Stay in this window until you submit. Leaving fullscreen or switching away is recorded as an incident."]),
          el("li", {}, ["Holding Escape, Alt+Tab, and the Windows key all count as incidents."]),
          el("li", {}, ["The Python editor only accepts a paste of text you copied from that same editor."]),
          el("li", {}, ["Draw both UML diagrams in the built-in editor. Your work is saved in this browser as you go."]),
          el("li", {}, ["The exam submits itself when the timer reaches zero. Write the receipt code on the attendance sheet, then upload the sealed PDF to the Google Form without changing it."]),
        ]),
        el("p", { class: "note" }, [note]),
      ]),
      form,
    ]),
    el("footer", { class: "foot" }, [
      "Invigilator tools are a deterrent, not a lock. ",
      el("button", { type: "button", class: "link", id: "invigilator-link" }, ["Invigilator"]),
    ]),
  ]));
  (config.GOOGLE_CLIENT_ID ? reg : name).focus();
}

export function mountUnsupported(parent, reason) {
  parent.replaceChildren(screen([
    el("section", { class: "card message-card" }, [
      el("div", { class: "status-icon is-bad", "aria-hidden": "true" }, ["!"]),
      el("h1", {}, ["Unsupported browser or device"]),
      el("p", {}, [reason]),
      el("p", { class: "muted" }, ["Open this exam on a lab PC in desktop Chrome or Edge."]),
    ]),
  ]));
}

export function mountBlocked(parent) {
  parent.replaceChildren(screen([
    el("section", { class: "card message-card" }, [
      el("div", { class: "status-icon is-warn", "aria-hidden": "true" }, ["!"]),
      el("h1", {}, ["Exam already open in another tab"]),
      el("p", {}, ["Close this tab and return to the original one. This tab will not start the exam."]),
    ]),
  ]));
}
