# QA

Checked on 2026-11-02 on Windows, Node v24, PowerShell. Headless Chrome rendered the gate. No interactive lab session was run.

## Automated

| Check | Result | Evidence |
| --- | --- | --- |
| `node --test` | PASS | 45 tests, 0 failures (re-run 2026-11-05). Includes Google token checks and `Code.gs` run with stand-in Google services. Includes lockdown, PIN hashing, PDF report round-trip and tamper, Pyodide replay, and a parent timer that keeps firing while a worker runs `while True: pass` and an endless `print`. |
| No question text in the site | PASS 2026-11-03 | Questions are handed out on paper. `data/`, the encryption tool, and question assignment were removed. In the browser the page text contains no system name or Part B task, and the diagram tabs read `Diagram 1` and `Diagram 2`. |
| Verify and summarize tools | PASS | The report test writes three PDF files, expects `OK`, edits the embedded name, expects exit code 1 and `TAMPERED`, and checks the CSV header plus the effort-indicator line on stderr. |
| Subfolder serve | PASS | `node tools/serve.mjs` on `127.0.0.1:8000`. `GET /` is 302 to `/lab-exam/`. 35 app files under that prefix returned 200, including wasm as `application/wasm`. A missing path returned 404. `/index.html` outside the prefix returned 404. |
| Gate HTML in headless Chrome | PASS | Chrome headless `--dump-dom` of `http://127.0.0.1:8000/lab-exam/` showed the course, the exam title, the rules, and "Start exam". stderr had Chrome extension-registry messages only, no page exception. |
| draw.io requested before login | PASS by inspection | The served `index.html` does not contain `embed.diagrams.net`. The iframe is created in `mountUml`, which runs after a successful gate. This was not confirmed with a network log of a clicked Start. |
| HTML sinks in application code | PASS | Search of `js/`, `css/`, `index.html`, `config.js`, `tools/`, and `tests/` for `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, and `new Function` found no matches. Student strings go through `textContent` or `escapeHtml`. |
| HTML sinks in vendor code | PASS with a note | Shipped CodeMirror files have no `innerHTML`. `vendor/pyodide/pyodide.mjs` contains the word `eval` inside its stack-parser. `pyodide.asm.mjs` is the Emscripten loader. Neither is an application sink for the student's name, code, or diagram labels. |
| Unexpected runtime origins | PASS with a note | Browser code that runs on the page: `config.js` has `https://embed.diagrams.net` only. `tools/serve.mjs` mentions `http://127.0.0.1` for the local server. CodeMirror files mention https URLs in comments. No application fetch uses another host. |
| `private/` ignored | PASS | After `git init`, `git check-ignore -v private/x` and `git check-ignore -v private/reference/x.py` both match `.gitignore:1:private/`. `node_modules/` is also ignored. |
| Repo size without `node_modules` or `private` | PASS | About 28 MB. Largest file `vendor/pyodide/pyodide.asm.wasm` is about 9.6 MB. `python_stdlib.zip` is about 2.5 MB. |

## Manual

| Check | Result |
| --- | --- |
| Hold Escape and leave fullscreen | NOT TESTED |
| Alt+Tab | NOT TESTED |
| Click a second monitor | NOT TESTED |
| Switch browser tab | NOT TESTED |
| Second tab of the same URL | NOT TESTED. The owner and blocked roles are unit-tested. Two real tabs were not opened. |
| Click inside the draw.io iframe does not score a violation | NOT TESTED |
| Both iframes reach `init`, autosave, PNG export, and restore after reload | PASS 2026-11-03 in a Chromium browser pane on localhost: both frames sent `init` within 1.5 s, a merged edit fired autosave and updated the shape badge, the diagram survived a reload, and both PNGs were embedded in the report. |
| Popup from inside the iframe is blocked | NOT TESTED. Sandbox omits `allow-popups`. No live embed was loaded. |
| Dead `DRAWIO_ORIGIN` shows Retry and "Call the invigilator" | NOT TESTED |
| Paste from outside the editor is blocked; paste of the editor's own copy works | NOT TESTED |
| Typed `input()` in the browser console, Stop, and `while True: pass` does not freeze the page clock | Typed `input()` PASS 2026-11-03 (Basic COCOMO golden values reproduced through the console). Stop and the infinite loop not run in the browser; the same runner and a worker-thread parent timer passed under Node. |
| Reload mid-exam resumes the same question and remaining time | PASS 2026-11-03. Same question, code, and diagram restored; the clock continued from the original start. The reload is logged as one incident (`UNLOAD_ATTEMPT`, `TAB_HIDDEN`, `FOCUS_LOST` merged). |
| Close and reopen the browser | NOT TESTED |
| Timer expiry auto-submits and the download works | NOT TESTED |
| Cold load on the lab network | NOT TESTED |
| Lab PC the day before, and a 3–5 student pilot | NOT TESTED |
| Keyboard Lock actually holds Escape until the two-second browser exit | NOT TESTED |
| Safe Exam Browser user agent | NOT TESTED. The `SEB` branch is unit-tested. |

## Security self-review

Application modules do not assign student text to an HTML parser. The report is a PDF: student text is drawn as PDF text with the built-in fonts, and the submission JSON is embedded as base64, so it cannot run in the teacher's viewer. A one-character change in the hashed payload fails verification.

The scaffold PIN was replaced on 2026-11-05; only its hash is in `config.js`. Earlier commits in this repository still contain `data/questions.json`; publish from a repository without that history if the question text must stay private.

## UI pass 2026-11-03

Fixed while checking the app against `Questions - Lab exam.doc`. All 25 questions in `data/questions.json` match the document word for word (Part A, Part B, and both diagram types).

| Issue | Fix |
| --- | --- |
| Reloading within 4 s showed "Exam already open in another tab" in the same tab. | The owner tab releases its heartbeat key on `pagehide`. |
| Start button stayed disabled when `requestFullscreen()` never settled. | 5 s timeout returns an error to the gate. |
| A second **Run** replayed the previous inputs, so the student could not type new ones. | **Run** and Ctrl+Enter start with no inputs. Only the console input row replays lines typed during the current run. |
| Console **Send** button did nothing; only Enter worked. | It is now the form's submit button. |
| Console input overflowed its row and focusing it scrolled the Python panel sideways. | Input is a shrinking flex item. |
| Gate inputs had no `type`, so they were unstyled. | Redesigned gate, shell, UML and Python tabs, overlay, submit dialog, receipt, and invigilator panel. |

Submit dialog now lists each diagram's shape count, warns on an empty diagram or code that was never run, and does not block submission. The pause overlay shows the incident count against `MAX_VIOLATIONS`.

## PDF report 2026-11-03

| Check | Result |
| --- | --- |
| Real submit in the browser pane with two draw.io diagrams and one Python run | PASS. Downloaded `URK22CS1001_Rishab_Haldar_Q5_report.pdf`, 45 KB, 4 pages: details and receipt, one page per diagram with the exported PNG, code with line numbers, last run, and the event table. `node tools/verify-submission.mjs` printed `OK`. |
| Build id hidden, readable dates | PASS. The printed text has no build id. Times read like `3 Nov 2026, 3:51:39 pm IST`, plus "Time taken". |
| jsPDF missing in the browser | NOT TESTED in the browser. The code falls back to a `.json` download that both tools accept. |
| Printing the PDF on a lab printer | NOT TESTED |

## Paper questions 2026-11-03

| Check | Result |
| --- | --- |
| Gate asks for the question number instead of an exam code | PASS. Empty and `30` are refused with "Enter your question number (1 to 25) from the question paper." `7` signs in and the top bar shows `Q7`. |
| Submit with two diagrams and one run | PASS. `URK22CS1001_Rishab_Haldar_Q7_report.pdf`, 2 pages, shows `Question number Q7`, `Part A - Diagram 1` and `Diagram 2` with their images, and the program. `verify-submission` printed `OK`. |

## Google sign-in and collection 2026-11-05

| Check | Result |
| --- | --- |
| Empty `GOOGLE_CLIENT_ID` | PASS. The gate shows typed name and email and does not load Google's script. |
| Google mode in the browser, with the real page and `Code.gs` behind a local stand-in server | PASS. Start refused until sign-in. The stand-in sign-in filled name and email. Start added an "In progress" Sheet row. Submit saved the PDF (verify printed `OK`, email marked "Google sign-in"), the row became "Submitted" with receipt and link, and the receipt said "Saved to the teacher's Google Drive". Resuming with the same account was accepted. |
| Real Google sign-in, real Apps Script deployment, real Drive and Sheet | NOT TESTED. Needs the teacher's Client ID and web app URL. Follow Part 4 of `docs/GOOGLE_SETUP.md`. |
| Diagrams in the same run | NOT TESTED that day. The browser pane blocked `embed.diagrams.net`, so both diagrams exported as empty. The diagram code was unchanged and was verified with real diagrams on 2026-11-03. |

## Sealed PDF 2026-11-05

| Check | Result |
| --- | --- |
| Browser PDF rebuilt byte for byte by `tools/verify-submission.mjs` | PASS. Two real submits in the browser pane (one with draw.io class and sequence diagrams). Both printed `OK: ... exactly as the exam produced it`. |
| Edited file | PASS. The same PDF with one line appended printed `EDITED` and exit code 1. Unit tests also cover a changed title, appended bytes, and a changed sealed payload (`TAMPERED`). |
| Opening and saving the PDF in Acrobat, Edge, or Chrome's "Save as PDF" | NOT TESTED. Expected `EDITED`, because any re-save rewrites the file. |
| Google Form upload keeps the file unchanged | NOT TESTED. Google Forms stores uploads as the original file. Check one test upload with the verify tool. |
| Apps Script upload | REMOVED. |

## Reopen after a mistaken submit 2026-11-05

| Check | Result |
| --- | --- |
| Submit, reopen with the invigilator PIN from the receipt screen, change the code, submit again | PASS in the browser pane. The diagram (2 shapes) and code came back, the timer continued from the original start, the new receipt screen said it replaces the first receipt, the PDF showed "Reopened: 1 time by the invigilator; replaces ...", and verify printed `OK`. |
| Reopen when time is up | Refused with "Use Add minutes first". Add minutes now also works after a submit. Unit-tested via `remainingMs`; not clicked through in the browser. |

## Duration, PIN, and sign-out 2026-11-05

| Check | Result |
| --- | --- |
| 90-minute exam | PASS. The gate shows "1 hr 30 min" and the timer starts at 1:29:58. |
| New invigilator PIN | PASS. The old scaffold PIN gets "Incorrect PIN"; the new PIN opens the panel. |
| Reopening the page after closing it | PASS. The gate asks for Google sign-in again; automatic sign-in is off (`auto_select: false` and `disableAutoSelect()`). The saved exam resumes after sign-in. |
| "Sign out of Google on this computer" on the receipt | PASS for the button and its confirmation. The real sign-out page (`accounts.google.com/Logout`) was not opened. |
| Chrome "clear cookies when all windows are closed" with an exception for the exam site | NOT TESTED. Follow docs/GOOGLE_SETUP.md on one lab PC. |
