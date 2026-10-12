"""Exact meridional ray trace through spherical surfaces centred on the Z axis. Pure Python.

Imported by the grader (which traces the prescription it fitted to the saved
meshes) and by reference.py. A surface is (z_vertex, curvature, n_before,
n_after); curvature is 1/R, positive when the centre is on the +Z side, 0 for a
flat. Light travels towards +Z.
"""
import math

# Refractive indices at F (486.13 nm), d (587.56 nm), C (656.27 nm), as the request states them.
GLASS = {
    "air": (1.0, 1.0, 1.0),
    "N-BK7": (1.52238, 1.51680, 1.51432),
    "N-SF5": (1.68750, 1.67270, 1.66661),
}
F, D, C = 0, 1, 2


def trace(surfaces, h, w):
    """A ray parallel to the axis at height h, wavelength index w. Returns (a, m): y = a + m * z after the last surface, or None."""
    y, z, dy, dz = h, surfaces[0][0] - 50.0, 0.0, 1.0
    for zv, c, n1, n2 in surfaces:
        s = z - zv
        b = c * (y * dy + s * dz) - dz
        cc = c * (y * y + s * s) - 2 * s
        disc = b * b - c * cc
        if disc < 0:
            return None
        t = cc / (-b + math.sqrt(disc))
        y, z = y + t * dy, z + t * dz
        nx, nz = -c * y, 1 - c * (z - zv)          # unit normal, along +Z at the vertex
        eta = n1[w] / n2[w]
        cosi = dy * nx + dz * nz
        k = 1 - eta * eta * (1 - cosi * cosi)
        if k < 0:
            return None
        g = math.sqrt(k) - eta * cosi
        dy, dz = eta * dy + g * nx, eta * dz + g * nz
    m = dy / dz
    return y - m * z, m


def paraxial(surfaces, w):
    """(effective focal length, z of the paraxial focus) at wavelength index w."""
    h = 1e-3
    a, m = trace(surfaces, h, w)
    return -h / m, -a / m


def spot(surfaces, beam_radius=10.0, rays=50, wavelengths=(F, D, C)):
    """(RMS spot radius, z of the plane) at the single plane that is best for all the wavelengths together.

    Rays sit on equal-area annuli of the beam, so each carries the same weight.
    """
    lines = []
    for w in wavelengths:
        for i in range(rays):
            r = trace(surfaces, beam_radius * math.sqrt((i + 0.5) / rays), w)
            if r is None:
                return float("inf"), float("nan")
            lines.append(r)
    saa = sum(a * a for a, m in lines)
    sam = sum(a * m for a, m in lines)
    smm = sum(m * m for a, m in lines)
    z = -sam / smm
    return math.sqrt(max(0.0, saa + 2 * z * sam + z * z * smm) / len(lines)), z


def doublet(c1, c2, c3, t1=6.0, t2=2.5, z0=0.0, gap=0.0, c2b=None):
    """Surfaces of a crown + flint doublet. With gap = 0 and c2b = None the two elements are cemented."""
    air, crown, flint = GLASS["air"], GLASS["N-BK7"], GLASS["N-SF5"]
    return [
        (z0, c1, air, crown),
        (z0 + t1, c2, crown, air),
        (z0 + t1 + gap, c2 if c2b is None else c2b, air, flint),
        (z0 + t1 + gap + t2, c3, flint, air),
    ]
