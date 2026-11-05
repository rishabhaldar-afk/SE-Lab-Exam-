# Lab Exam Console

A static website for a software engineering lab exam. Each student gets a question on paper from the teacher: two UML diagrams (Part A) and one Python program (Part B). The site holds no question text. Students draw the diagrams in two embedded draw.io editors (Diagram 1 and Diagram 2), write and run the program in Pyodide, and download one PDF report with a SHA-256 receipt.

There is no build step and no server. GitHub Pages can host the files as they are.

Students sign in with their college Google account, download a sealed PDF, and upload it to a Google Form. The verify tool shows whether a PDF is exactly what the exam produced. Setup and checking: [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md).

## Before a real exam

1. Replace `INVIGILATOR_PIN_HASH` in `config.js` with the output of `node tools/make-hash.mjs`. The scaffold PIN `lab-invigilator` is public.
2. Set `QUESTION_COUNT` to the highest question number on your papers.
3. Create the Google Form and prepare an attendance sheet with a column for the receipt code. See [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md).
4. Print the question papers. Students type their question number at sign-in, so make it easy to see on each paper.

`node --test` must pass before you publish.

## What the student does

1. Open the site in desktop Chrome or Edge. Firefox can run the exam, but it cannot lock the Escape key.
2. Sign in with Google (when set up) or type full name and email, then enter register number and the question number from their paper, tick the rules, and press **Start exam**. The page enters fullscreen.
3. Draw the two diagrams from the paper in **Diagram 1** and **Diagram 2** on the UML tab. Write and run the Python program on the other tab. The starter file is only `# Qn`.
4. Press **Submit**, or wait until the timer reaches zero. The timer submits without a second confirmation.
5. Download the sealed PDF report. If the first download is blocked, use **Download report again**. Write the receipt code on the attendance sheet, then upload the PDF to the Google Form without opening or re-saving it.

The same register number resumes the same work and keeps the question number from the first sign-in. The timer continues from the original start. A submitted register number only shows the receipt again.

The register number is trimmed, uppercased, and stripped of spaces, then checked against `REGNO_PATTERN`.

## Configuration

Edit `config.js`. Each field is commented there.

| Field | Scaffold value | Meaning |
| --- | --- | --- |
| `EXAM_TITLE`, `COURSE` | Software Engineering Lab Exam | Shown on the gate |
| `EXAM_DURATION_MIN` | 120 | Clock length from the first successful start |
| `EXAM_CLOSES_AT` | `null` | Optional ISO close time. The earlier of this and the duration ends the exam |
| `MAX_VIOLATIONS` | 3 | Counted incidents before the screen locks |
| `QUESTION_COUNT` | 25 | Highest question number a student can enter |
| `INVIGILATOR_PIN_HASH` | hash of `lab-invigilator` | Replace before a real exam |
| `RUN_TIMEOUT_MS` | 5000 | One continuous Python run |
| `OUTPUT_LIMIT_BYTES` | 200000 | Then the run is stopped |
| `GOOGLE_CLIENT_ID` | empty | Google sign-in. Empty: students type name and email |
| `GOOGLE_ALLOWED_DOMAIN` | `karunya.edu.in` | Only this domain's Google accounts may sign in |
| `DRAWIO_ORIGIN` | `https://embed.diagrams.net` | Diagram editor. With Google sign-in, the page also loads `accounts.google.com` |
| `REGNO_PATTERN` | see the file | Applied after normalisation |
| `BUILD_ID` | date stamp | Stored in the report's embedded data, not printed |

## Deploy to GitHub Pages

1. Create an empty public repository.
2. Push this project to branch `main`. The site root is the repository root. Do not add a build command.
3. In the repository settings, set Pages to deploy from branch `main` and folder `/ (root)`.
4. Open `https://<user>.github.io/<repo>/`. `.nojekyll` is present so Pages serves the files as they are.
5. Every URL in the page is relative, so a project site under `/<repo>/` works. Confirm the gate loads and the browser network panel shows no 404.

`node_modules/` and `private/` are gitignored. The Pyodide and CodeMirror files under `vendor/` must be in the repository. Students do not run npm.

## Preview locally

Node 20 or newer:

```
npm install
npm test
npm run serve
```

Open `http://127.0.0.1:8000/lab-exam/`. The server only answers under that prefix, which matches a GitHub project site. `npm install` is for tests and the teacher tools. The page does not need it.

## Exam-day runbook

The day before:

- On a lab PC, open the site once in Chrome or Edge so Pyodide (about 12 MB of wasm and the standard library) is in the browser cache.
- Check fullscreen, one diagram editor, one Python run, and a downloaded report.
- Put the new PIN hash in `config.js` and redeploy if you changed it.

At the start:

- Hand out the question papers. Remind students to type their question number exactly as printed.
- Students use desktop Chrome or Edge. Safari, phones, and tablets are blocked on the gate.
- Each student keeps one tab. A second tab of the same URL shows "Exam already open in another tab" and does not start another session.

During the exam the footer link **Invigilator**, or Ctrl+Alt+Shift+I, asks for the PIN. Actions: unlock, add minutes, force submit, correct a question number for a register number, show diagnostics. A corrected question number applies the next time that register number signs in, and the student's work is kept. Unlock sets the incident count back to zero. Every action is written into the event log. The PIN is a deterrent. Anyone who can read `config.js` can offline-test guesses against the hash.

After the exam, collect the PDF reports and from a machine with this repository:

```
node tools/verify-submission.mjs report.pdf
node tools/summarize.mjs reports-folder
```

`verify-submission` prints `OK`, `EDITED`, or `TAMPERED`. Each PDF carries the full submission (code, diagram XML, event log) and the settings it was drawn with in its XMP metadata. The tool rebuilds the PDF from that data: the same data always gives the same bytes, so any change to the file shows as `EDITED`, and a change to the data shows as `TAMPERED`. A student could still rebuild a fake from the public code, so compare each receipt with the one written on the attendance sheet. If the PDF library ever fails in a student's browser, the download is a `.json` file of the same data, and both tools accept it (data check only). `summarize` writes a CSV with the receipt and this result. Diagram cell counts are a rough effort indicator, not a grade. The site does not grade answers.

## Limits

A web page cannot hold a student inside the exam.

- Holding Escape for about two seconds leaves fullscreen even when Keyboard Lock is on. That exit is detected, hidden, logged, and counted. It is not prevented.
- Alt+Tab, the Windows key, and Ctrl+Alt+Del belong to the operating system.
- DevTools, a second device, a screenshot, and another person are outside what this page can see. The page does not try to detect DevTools by window size.
- The repository and the GitHub Pages site are public. A PIN and a timer in JavaScript are deterrents, not security.
- The Python sandbox blocks casual imports of the network and of `js` / Pyodide helpers. It is not an operating-system sandbox.
- For stronger control, use Safe Exam Browser or a managed Chrome policy on the lab PCs. If the user agent contains `SEB`, the page skips the fullscreen requirement and does not score fullscreen or focus events.

Work is stored in `localStorage` for that browser profile. Clearing site data deletes the attempt. If storage is full, the saved copy drops the stored PDF and diagram images. The file downloaded at submit still has them, but **Download report again** after a reload is then unavailable.

## Layout

`index.html` loads the gate. `js/core/` has no DOM and is what `node --test` covers. `js/ui/` is the page. `py/runner.py` is the Python session used both by the browser worker and by the tests. Teacher tools live in `tools/`. Reference solutions live in `private/reference/` and must stay uncommitted.

Vendored code is listed in `vendor/README.md` (Pyodide 314.0.7, MPL-2.0; CodeMirror 5.65.18, MIT).
