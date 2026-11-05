"""Replay runner for the lab exam. Loaded by the Pyodide worker and by Node tests.

Student code runs in a fresh globals dict. input() is non-blocking: a missing
line posts need_input and raises NeedInput (a BaseException).
"""

import builtins
import json
import os
import random
import sys
import traceback

try:
    import examio as _examio
except Exception:
    _examio = None


class NeedInput(BaseException):
    """Raised when input() has no replayed line left. Not an Exception."""


_FRIENDLY = {"numpy", "tkinter", "matplotlib", "pygame"}
_BLOCK_ROOTS = {"js", "pyodide_js", "micropip", "pyodide", "socket", "examio", "_exam_runner"}
_BLOCK_NAMES = _BLOCK_ROOTS | {"http.client", "urllib.request"}
_BLOCK_PAIRS = {("http", "client"), ("urllib", "request")}

_real_import = builtins.__import__
_state = {
    "queue": [],
    "silence": False,
    "parts": [],
}


def _deny(name):
    root = name.split(".")[0]
    if root in _FRIENDLY or name in _FRIENDLY:
        raise ImportError("Only the standard library is available in this exam")
    raise ImportError(f"Import of {name} is disabled in this exam.")


def _guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
    root = name.split(".")[0]
    if root in _FRIENDLY or name in _FRIENDLY or root in _BLOCK_ROOTS or name in _BLOCK_NAMES:
        _deny(name)
    if name.startswith("pyodide"):
        _deny(name)
    if fromlist:
        for item in fromlist:
            if (name, item) in _BLOCK_PAIRS or item in _BLOCK_ROOTS:
                _deny(f"{name}.{item}")
    return _real_import(name, globals, locals, fromlist, level)


def _emit(kind, text):
    if not text or _state["silence"]:
        return
    _state["parts"].append(text)
    if _examio is None:
        return
    if kind == "err":
        _examio.write_err(text)
    else:
        _examio.write_out(text)


class _Out:
    def __init__(self, kind):
        self.kind = kind

    def write(self, data):
        text = "" if data is None else str(data)
        _emit(self.kind, text)
        return len(text)

    def flush(self):
        return None


def _read_line(prompt=""):
    prompt = "" if prompt is None else str(prompt)
    if _state["silence"]:
        raise NeedInput()
    if prompt:
        _emit("out", prompt)
    queue = _state["queue"]
    if queue:
        line = queue.pop(0)
        _emit("out", line + "\n")
        return line
    _state["silence"] = True
    if _examio is not None:
        _examio.need_input(prompt)
    raise NeedInput()


class _Stdin:
    def readline(self, size=-1):
        return _read_line("") + "\n"

    def read(self, size=-1):
        if not _state["queue"]:
            return _read_line("") + "\n"
        chunks = []
        taken = 0
        while _state["queue"]:
            line = _state["queue"].pop(0)
            _emit("out", line + "\n")
            piece = line + "\n"
            chunks.append(piece)
            taken += len(piece)
            if size is not None and size >= 0 and taken >= size:
                break
        return "".join(chunks)

    def flush(self):
        return None


def _system(cmd):
    if str(cmd).strip().lower() in ("cls", "clear"):
        _state["parts"].clear()
        if _examio is not None:
            _examio.clear_console()
        return 0
    raise OSError("os.system is disabled in this exam")


def _format_runtime(exc):
    frames = []
    tb = exc.__traceback__
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == "main.py":
            frames.append(tb)
        tb = tb.tb_next
    lines = ["Traceback (most recent call last):\n"]
    for frame in frames:
        lines.append(f'  File "main.py", line {frame.tb_lineno}, in {frame.tb_frame.f_code.co_name}\n')
    lines.extend(traceback.format_exception_only(type(exc), exc))
    return "".join(lines)


def _format_syntax(exc):
    line = exc.lineno or 1
    text = "".join(traceback.format_exception_only(type(exc), exc))
    return f'Traceback (most recent call last):\n  File "main.py", line {line}\n{text}'


def _coerce_inputs(inputs):
    if inputs is None:
        return []
    try:
        return [str(item) for item in list(inputs)]
    except Exception:
        return []


def run_user(code, inputs):
    """Run student code. Returns a JSON string: status, transcript, error."""
    global _state
    _state = {
        "queue": _coerce_inputs(inputs),
        "silence": False,
        "parts": [],
    }
    random.seed(12345)
    globs = {"__name__": "__main__"}
    old_input = builtins.input
    old_import = builtins.__import__
    old_stdout = sys.stdout
    old_stderr = sys.stderr
    old_stdin = sys.stdin
    old_system = os.system
    hidden = []
    for name in ("examio", "_exam_runner"):
        if name in sys.modules:
            hidden.append((name, sys.modules.pop(name)))
    status = "ok"
    error = None
    try:
        builtins.input = _read_line
        builtins.__import__ = _guarded_import
        sys.stdout = _Out("out")
        sys.stderr = _Out("err")
        sys.stdin = _Stdin()
        os.system = _system
        compiled = compile(code, "main.py", "exec")
        exec(compiled, globs, globs)
    except NeedInput:
        status = "need_input"
    except SystemExit:
        status = "ok"
    except SyntaxError as exc:
        status = "error"
        error = _format_syntax(exc)
        _emit("err", error if error.endswith("\n") else error + "\n")
    except Exception as exc:
        status = "error"
        error = _format_runtime(exc)
        _emit("err", error if error.endswith("\n") else error + "\n")
    finally:
        builtins.input = old_input
        builtins.__import__ = old_import
        sys.stdout = old_stdout
        sys.stderr = old_stderr
        sys.stdin = old_stdin
        os.system = old_system
        for name, module in hidden:
            sys.modules[name] = module
    transcript = "".join(_state["parts"])
    return json.dumps({"status": status, "transcript": transcript, "error": error})
