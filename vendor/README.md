# Vendored libraries

No runtime CDN. These files are served by the site.

| Name | Version | Licence | Files |
| --- | --- | --- | --- |
| Pyodide | 314.0.7 | MPL-2.0 | `pyodide/pyodide.mjs`, `pyodide.asm.mjs`, `pyodide.asm.wasm`, `python_stdlib.zip`, `pyodide-lock.json` |
| CodeMirror | 5.65.18 | MIT | `codemirror/codemirror.js`, `codemirror.css`, `python.js`, `matchbrackets.js`, `LICENSE` |
| jsPDF | 4.2.1 | MIT | `jspdf/jspdf.umd.min.js`, `jspdf/LICENSE` |

Pyodide is the core distribution only (the files `loadPyodide({ indexURL })` fetches). Copied from the `pyodide@314.0.7` npm package. Licence text: https://github.com/pyodide/pyodide/blob/314.0.7/LICENSE

CodeMirror 5 licence is in `codemirror/LICENSE`. Python mode and the matchbrackets addon are part of that release.

jsPDF builds the PDF report in the browser. The UMD bundle includes its PNG and compression code. Its optional HTML-rendering add-ons (html2canvas, DOMPurify, canvg) are not used and not shipped.

`pyodide`, `codemirror`, and `jspdf` are also devDependencies so `node --test` can load the same Pyodide version. The exam page does not run npm and does not download those packages.
