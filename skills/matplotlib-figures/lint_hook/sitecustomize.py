"""Auto-figlint: lints every matplotlib figure AT SAVE TIME, inside the plot
script's own process — no re-execution, no opt-in.

Injected by the hardened bash tool via PYTHONPATH (rung-4 of the mechanism
ladder). The prompt-mandated `figlint` CLI was never invoked on the 297nm
run because figures flow through brain/experiment paths that never read the
illustrator prompts — instruction failed to reach the producer, so the tool
layer enforces instead. Findings print to stderr with a [figlint] prefix and
land in the bash tool result the writing agent already reads; the script's
exit code is never altered.

Activation is cheap and targeted: only when argv[0] is a .py file whose
source mentions matplotlib (pytest, -c, and non-plot scripts pay one small
file read, nothing more).
"""
import sys, os


def _install():
    try:
        script = sys.argv[0] if sys.argv else ""
        if not (isinstance(script, str) and script.endswith(".py") and os.path.isfile(script)):
            return
        with open(script, "r", errors="ignore") as fh:
            src = fh.read(200_000)
        if "matplotlib" not in src and "pyplot" not in src:
            return
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from figlint_core import lint_figure
        import matplotlib
        from matplotlib.figure import Figure
        orig = Figure.savefig

        def patched(self, fname, *a, **k):
            try:
                errors, warnings = lint_figure(self, os.path.basename(str(fname)), k.get("bbox_inches") == "tight")
                for w in warnings:
                    print(f"[figlint] WARN  {w}", file=sys.stderr)
                for e in errors:
                    print(f"[figlint] ERROR {e}", file=sys.stderr)
                if errors:
                    print(f"[figlint] {len(errors)} layout error(s) in {os.path.basename(str(fname))} — "
                          f"fix label positions/canvas before using this figure in the report.", file=sys.stderr)
            except Exception:
                pass  # linting must never break the science script
            return orig(self, fname, *a, **k)

        Figure.savefig = patched
    except Exception:
        pass


_install()
