#!/usr/bin/env python3
"""colorkey — the palette and the report's colour key, shared by figspec and levelspec.

Measured on the Luxas paper corpus (1,168 papers, 10,597 figures, 2026-11-07; numbers in
skills/figure/references/figure_types.md):

* Schematics (level diagrams, setups) are black. Colour goes on drive arrows, by wavelength
  (`beam`). A level or an object is coloured only when the colour names an identity that the
  report's data figures also use.
* Data figures: text black, at most two hue families per panel, one family per identity.
* Inside one paper the same identity keeps the same colour in every figure (the median figure
  draws 99% of its colour in colours that the paper's other figures also use).

The key is a small JSON file at <report>/figures/colorkey.json. The first figure that names an
identity claims the next free family and writes it there; every later figure reads it, so "Dy"
is the same blue in Fig. 1 and Fig. 4. `python3 colorkey.py [path]` prints a key.

Stdlib only: levelspec must run without numpy.
"""
import json, math, os, re, sys, tempfile

# ── The palette, as plain hex. Draw with these directly: PALETTE["blue"]["m"], HEX["blue.m"], or the flat
# names BLUE, BLUE_D, BLUE_L, BLUE_P, …  Tints: d dark (text, marker edges), m mid (lines, arrows),
# l light (marker fill, bands), p pale (areas). Contrast on white: d >= 7 (body text), m >= 3 (lines).
PALETTE = {
    "blue":   {"d": "#174F75", "m": "#3B7CAE", "l": "#A3C1E2", "p": "#E4ECF6"},
    "red":    {"d": "#892F2D", "m": "#CA5852", "l": "#ECACA4", "p": "#FCE6E3"},
    "orange": {"d": "#804619", "m": "#D17B3A", "l": "#F5C19F", "p": "#FFEADD"},
    "green":  {"d": "#2B5731", "m": "#497E50", "l": "#A7CAA9", "p": "#E5F1E6"},
    "plum":   {"d": "#62396D", "m": "#8A6194", "l": "#CAB1CF", "p": "#F1E8F2"},
    "sand":   {"d": "#6A5124", "m": "#AD8B55", "l": "#EACDA5", "p": "#FBEFE0"},
}
GREYS = {"ink": "#2C2C2C", "g7": "#595959", "g5": "#868686", "g3": "#B9B9B9", "g1": "#DFDFDF", "g0": "#F3F3F3"}
BLACK = "#000000"
GREY = "#6E6E6E"        # secondary text, references, unused levels
DECAY = "#000000"
# Drive colours by vacuum wavelength (upper bound in nm, colour): the order seen in the corpus's level
# diagrams — UV purple, ~420 violet, ~460–480 blue, 5xx green, 578 amber, 626–649 red-orange,
# 689–852 red, beyond 1 um dark red. Contrast on white >= 3.6 so an arrow and its label both read.
BEAMS = [(380, "#7B3FA0"), (440, "#4E4BC0"), (495, "#2F6FC0"), (570, "#2E8B47"), (605, "#B07C00"),
         (660, "#E0561F"), (760, "#C8302B"), (1000, "#A3262A"), (float("inf"), "#7A1F1F")]
BEAM = {"uv": "#7B3FA0", "violet": "#4E4BC0", "blue": "#2F6FC0", "green": "#2E8B47", "amber": "#B07C00",
        "red_orange": "#E0561F", "red": "#C8302B", "deep_red": "#A3262A", "ir": "#7A1F1F"}

# Claim order. Blue and red first (spin down / up in the Bloch figures; 34 dE2000 apart for a red–green
# colour-blind reader). Any third family is confusable with one of the first two, which is why a panel
# carries at most two families plus grey.
ORDER = ["blue", "red", "orange", "green", "plum", "sand"]
FAMILIES = PALETTE      # family names, for validation

# Flat names: BLUE (= mid), BLUE_D, BLUE_L, BLUE_P, …, and HEX["blue.m"], HEX["grey.ink"].
HEX = {f"{f}.{k}": v for f, tints in PALETTE.items() for k, v in tints.items()}
HEX.update({f"grey.{g}": v for g, v in GREYS.items()})
for _f, _t in PALETTE.items():
    globals()[_f.upper()] = _t["m"]
    for _k in "dlp":
        globals()[f"{_f.upper()}_{_k.upper()}"] = _t[_k]

# How the hex values were made (kept so the gate can re-derive them; nothing reads these at draw time):
# CIELAB (L, C) per tint at one hue angle h. Mid and light targets from 63 Bloch-group figures
# (blue mid L50 C32, green mid L47 C40, light tints L75–86 C19–29).
DERIVATION = {
    "blue":   dict(h=262, d=(32, 27), m=(50, 33), l=(77, 20), p=(93, 6)),
    "red":    dict(h=30,  d=(33, 44), m=(52, 52), l=(76, 26), p=(93, 8)),
    "orange": dict(h=60,  d=(36, 42), m=(60, 56), l=(82, 28), p=(94, 10)),
    "green":  dict(h=145, d=(33, 30), m=(48, 34), l=(78, 22), p=(94, 7)),
    "plum":   dict(h=320, d=(31, 36), m=(47, 34), l=(75, 19), p=(93, 6)),
    "sand":   dict(h=80,  d=(36, 30), m=(60, 34), l=(84, 24), p=(95, 9)),
}
GREY_L = {"ink": 18, "g7": 38, "g5": 56, "g3": 75, "g1": 89, "g0": 96}


def lab_to_hex(L, a, b):
    fy = (L + 16) / 116
    fx, fz = fy + a / 500, fy - b / 200
    inv = lambda t: t ** 3 if t ** 3 > 216 / 24389 else (116 * t - 16) / (24389 / 27)
    X, Y, Z = inv(fx) * 0.95047, inv(fy), inv(fz) * 1.08883
    r = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z
    g = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z
    bb = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z
    enc = lambda v: 12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
    return "#%02X%02X%02X" % tuple(int(round(255 * min(1, max(0, enc(v))))) for v in (r, g, bb))


def derived():
    """Re-derive every hex from DERIVATION (smoke_colorkey checks it equals PALETTE / GREYS)."""
    out = {}
    for f, s in DERIVATION.items():
        out[f] = {t: lab_to_hex(s[t][0], s[t][1] * math.cos(math.radians(s["h"])), s[t][1] * math.sin(math.radians(s["h"])))
                  for t in "dmlp"}
    return out, {g: lab_to_hex(L, 0, 0) for g, L in GREY_L.items()}


def tint(family, t):
    """tint('blue', 'm') -> '#3B7CAE' (the same as PALETTE['blue']['m'])."""
    return PALETTE[family][t]


def grey(name):
    return GREYS[name]


def mids():
    """The data-figure colour cycle, in claim order. The venue .mplstyle files carry the same list."""
    return [tint(f, "m") for f in ORDER]


def contrast_on_white(hexc):
    lin = lambda v: v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(int(hexc[i:i + 2], 16) / 255) for i in (1, 3, 5))
    return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05)


def beam(nm):
    """Colour of a laser drive (arrow, beam, its label) by wavelength in nm."""
    for upper, hexc in BEAMS:
        if nm < upper:
            return hexc
    return BEAMS[-1][1]


_WL = re.compile(r"(\d+(?:\.\d+)?)\s*(?:\\,|~|-|\s)?\s*(nm|\\mu\s*m|\\upmu\s*m|µm|μm|um)\b")
_RADIO = re.compile(r"\b(\d+(?:[.,]\d+)?\s*(?:\\,|~|\s)?\s*[kMG]Hz|RF|MW|microwave|radio)\b", re.I)


def wavelength_nm(text):
    """The wavelength written in a label ('626 nm', '1064.5-nm', '2.42 µm', r'2.42\\,\\mu m') in nm, else None."""
    m = _WL.search(re.sub(r"(?<=\d),(?=\d{3}(?!\d))", "", text or ""))   # 1,064 nm is a thousands separator
    if not m:
        return None
    v = float(m.group(1))
    return v if m.group(2) == "nm" else v * 1000


def is_radio(text):
    """A radio-frequency or microwave drive: no wavelength colour; it takes an identity colour or black."""
    return bool(_RADIO.search(text or "")) and wavelength_nm(text) is None


def norm(name):
    """'$^{161}$Dy' and '161 Dy' are the same identity."""
    return re.sub(r"[\s$^_{}\\]|mathrm|text", "", str(name)).lower()


class Key:
    """A report's colour key. `family(name)` returns the identity's family, claiming the next free one
    (and saving) the first time an identity is named. Without a path the key lives in memory only."""

    def __init__(self, path=None):
        self.path = path
        self.data = {"version": 1, "identities": {}, "drive_labels": "arrow"}
        if path and os.path.exists(path):
            with open(path) as f:
                d = json.load(f)
            if not isinstance(d, dict) or not isinstance(d.get("identities", {}), dict):
                raise ValueError(f"{path}: not a colour key (expected {{\"identities\": {{name: family}}}})")
            self.data.update(d)
            for name, fam in self.data["identities"].items():
                if fam not in FAMILIES:
                    raise ValueError(f"{path}: identity {name!r} has family {fam!r} — one of {', '.join(ORDER)}")

    def _find(self, name):
        n = norm(name)
        for k, fam in self.data["identities"].items():
            if norm(k) == n:
                return k, fam
        return None, None

    def family(self, name, create=True):
        _, fam = self._find(name)
        if fam or not create:
            return fam
        used = set(self.data["identities"].values())
        fam = next((f for f in ORDER if f not in used), None)
        if fam is None:   # six identities is already more than a reader can track; reuse in order, say so
            fam = ORDER[len(self.data["identities"]) % len(ORDER)]
            print(f"colorkey: more than {len(ORDER)} identities in this report — {name!r} shares {fam} "
                  f"with another identity; group them, or show the rest in grey", file=sys.stderr)
        self.data["identities"][str(name)] = fam
        self.save()
        return fam

    def color(self, name, t="m"):
        return tint(self.family(name), t)

    @property
    def drive_labels(self):
        return self.data.get("drive_labels", "arrow")

    def save(self):
        if not self.path:
            return
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(self.path) or ".", suffix=".tmp")
        with os.fdopen(fd, "w") as f:
            json.dump(self.data, f, indent=1, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, self.path)


def key_path(out):
    """Where the key for a figure written at `out` lives: $LUXAS_COLORKEY, else <report>/figures/colorkey.json
    for the nearest enclosing directory named 'report' (or the project that has one), else None."""
    if os.environ.get("LUXAS_COLORKEY"):
        return os.environ["LUXAS_COLORKEY"]
    d = os.path.dirname(os.path.abspath(out))
    while True:
        if os.path.basename(d) == "report":
            return os.path.join(d, "figures", "colorkey.json")
        if os.path.isdir(os.path.join(d, "report")) and os.path.exists(os.path.join(d, "RESEARCH.md")):
            return os.path.join(d, "report", "figures", "colorkey.json")
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def load_for(out):
    return Key(key_path(out))


if __name__ == "__main__":
    p = sys.argv[1] if len(sys.argv) > 1 else key_path(os.path.join(os.getcwd(), "x"))
    k = Key(p)
    print(f"colour key: {p or '(none — no report/ directory above here)'}")
    for name, fam in k.data["identities"].items():
        print(f"  {name:24s} {fam:7s} line {tint(fam, 'm')}  text {tint(fam, 'd')}  fill {tint(fam, 'l')}  band {tint(fam, 'p')}")
    print("drive labels:", k.drive_labels)
    print("data cycle:", " ".join(mids()))
