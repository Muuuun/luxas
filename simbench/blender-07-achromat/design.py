"""Where reference.py's prescriptions come from. Pure Python, no Blender:

    python3 design.py

For a chosen front curvature c1, Newton solves the other two curvatures for the
focal-length and colour targets; then c1 is scanned for the smallest spot at d.
Prints the reference and the planted-fault prescriptions.
"""
import optics as O


def measure(c1, c2, c3, t1=6.0, t2=2.5):
    s = O.doublet(c1, c2, c3, t1, t2)
    return O.paraxial(s, O.D)[0], O.paraxial(s, O.F)[1] - O.paraxial(s, O.C)[1], O.spot(s, wavelengths=(O.D,))[0] * 1000


def newton2(f, x, y):
    for _ in range(80):
        e = f(x, y)
        if abs(e[0]) < 1e-10 and abs(e[1]) < 1e-11:
            break
        d = 1e-7
        ex, ey = f(x + d, y), f(x, y + d)
        a, b, c, dd = (ex[0] - e[0]) / d, (ey[0] - e[0]) / d, (ex[1] - e[1]) / d, (ey[1] - e[1]) / d
        det = a * dd - b * c
        x, y = x - (dd * e[0] - b * e[1]) / det, y - (-c * e[0] + a * e[1]) / det
    return x, y


def best(efl, colour, t1=6.0, lo=0.0170, hi=0.0200):
    """Smallest d spot over c1 in [lo, hi] with the focal length and colour targets met exactly."""
    out, c2, c3 = None, -0.0212, -0.0054
    for i in range(301):
        c1 = lo + (hi - lo) * i / 300
        c2, c3 = newton2(lambda a, b: (measure(c1, a, b, t1)[0] - efl, measure(c1, a, b, t1)[1] - colour), c2, c3)
        rms = measure(c1, c2, c3, t1)[2]
        if out is None or rms < out[3]:
            out = (c1, c2, c3, rms)
    return out


def show(name, c1, c2, c3, t1=6.0):
    efl, col, rms = measure(c1, c2, c3, t1)
    r = lambda c: "flat" if abs(c) < 1e-9 else f"{1 / c:.4f}"
    print(f"{name:22s} c = ({c1:.8f}, {c2:.8f}, {c3:.8f})  R = ({r(c1)}, {r(c2)}, {r(c3)})  t1 = {t1}  EFL {efl:.3f}  F-C {col:+.4f}  spot(d) {rms:.3f} um")


if __name__ == "__main__":
    show("reference", *best(100.0, 0.0)[:3])
    show("efl_103", *best(103.0, 0.0)[:3])
    show("colour_uncorrected", *best(100.0, 0.15, hi=0.0260)[:3])
    show("crown_8mm", *best(100.0, 0.0, t1=8.0)[:3], t1=8.0)
    # Flat back surface: the remaining two curvatures meet the focal length and colour, nothing is left for the bending.
    c1, c2 = newton2(lambda a, b: (measure(a, b, 0.0)[0] - 100.0, measure(a, b, 0.0)[1]), 0.024, -0.016)
    show("plano_back", c1, c2, 0.0)
