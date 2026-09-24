"""Parse the Kurucz Y I electric-dipole (E1) line list.

The Kurucz ``gf3900.lines`` file is a fixed-width ASCII table with one
transition per record.  Each record contains (in order)::

    wavelength (nm, standard air)
    log10(gf)            (gf = g_lower * f)
    atomic number        (39.00 for Y)
    lower-level energy   (cm^-1)
    lower J
    lower config+term label   (variable length, embedded spaces)
    upper-level energy   (cm^-1)
    upper J
    upper label               (variable length, embedded spaces)
    trailing columns          (ignored)

The config/term labels are variable-length strings with embedded spaces, so a
naive whitespace split cannot be used for every field.  Instead the leading
numeric fields are matched by a regex that lets the lower label consume
arbitrary text up to the first numeric field that carries a decimal point
(the upper energy, which in this file is always written with a ``.ddd``
fractional part while the integer-looking tokens that occur inside Kurucz
level labels never contain a decimal point).

Energy conventions
------------------
* Bound levels (stored energy >= 0, below the 50145.6 cm^-1 ionization limit)
  are absolute energies above the ground state; the stored value is used
  directly.
* Autoionizing levels are stored with a negative value whose magnitude is
  *not* the absolute energy.  For a line whose upper level is autoionizing,
  the absolute upper energy is reconstructed as ``E_lower + dE`` with
  ``dE = 1e7 / lambda_vac`` (cm^-1, lambda_vac in nm).

Only lines whose lower level is bound are kept.
"""

from __future__ import annotations

import re

__all__ = ["parse_kurucz"]

# Edlen (1966) / Morton (1991) standard-air refractive index coefficients.
#   n_air - 1 = 1e-8 * (A + B / (C - s^2) + D / (E - s^2))
# where s = 1 / lambda_vac with lambda_vac in microns.  This is the standard
# formula used for air <-> vacuum wavelength conversion in atomic line lists.
_EDLEN_A = 8342.54
_EDLEN_B = 2406147.0
_EDLEN_C = 130.0
_EDLEN_D = 15998.0
_EDLEN_E = 38.9

# One record: 5 leading numeric fields, a variable-length lower label, the
# upper energy (always written with a decimal point), the upper J, and the
# rest (upper label + trailing columns, ignored).
_RECORD_RE = re.compile(
    r"^\s*"
    r"(\S+)\s+"            # 1  wavelength (nm, standard air)
    r"(\S+)\s+"            # 2  log10(gf)
    r"(\S+)\s+"            # 3  atomic number
    r"(\S+)\s+"            # 4  lower energy (cm^-1)
    r"(\S+)\s+"            # 5  lower J
    r"(.+?)\s+"            # 6  lower config+term label (embedded spaces)
    r"([-+]?\d+\.\d+)\s+"  # 7  upper energy (cm^-1)
    r"([-+]?\d+\.\d+)\s+"  # 8  upper J
    r"(.*)$"               # 9  upper label + trailing columns (ignored)
)

# Spontaneous-emission prefactor for A = C / lambda[A]^2 * gf / (2J_u + 1).
_A_PREFACTOR = 0.66702e15


def _air_to_vac_nm(wl_air_nm: float) -> float:
    """Convert a standard-air wavelength (nm) to a vacuum wavelength (nm)."""
    # s is defined at the vacuum wavelength; iterate once from the air
    # wavelength (n - 1 ~ 3e-4, so a single iteration is more than enough).
    lam_um = wl_air_nm * 1e-3
    n_air = 1.0 + 1e-8 * (
        _EDLEN_A
        + _EDLEN_B / (_EDLEN_C - (1.0 / lam_um) ** 2)
        + _EDLEN_D / (_EDLEN_E - (1.0 / lam_um) ** 2)
    )
    lam_vac_um = lam_um * n_air
    n_air = 1.0 + 1e-8 * (
        _EDLEN_A
        + _EDLEN_B / (_EDLEN_C - (1.0 / lam_vac_um) ** 2)
        + _EDLEN_D / (_EDLEN_E - (1.0 / lam_vac_um) ** 2)
    )
    return wl_air_nm * n_air


def _parse_record(line: str) -> dict[str, float] | None:
    """Parse a single record; return None for anything malformed."""
    m = _RECORD_RE.match(line)
    if m is None:
        return None
    try:
        wl_air_nm = float(m.group(1))
        log_gf = float(m.group(2))
        # group(3) atomic number is validated by the record shape but unused.
        e_low = float(m.group(4))
        j_low = float(m.group(5))
        e_up_stored = float(m.group(7))
        j_up = float(m.group(8))
    except ValueError:
        return None

    return {
        "wl_air_nm": wl_air_nm,
        "log_gf": log_gf,
        "E_lower_stored": e_low,
        "J_lower": j_low,
        "E_upper_stored": e_up_stored,
        "J_upper": j_up,
    }


def parse_kurucz(lines_path: str) -> list[dict[str, float]]:
    """Parse the Kurucz Y I E1 line list into a normalized transition table.

    Parameters
    ----------
    lines_path : str
        Path to a Kurucz ``gf*.lines`` file.

    Returns
    -------
    list of dict
        Each entry has keys ``E_lower_cm``, ``E_upper_cm``, ``J_lower``,
        ``J_upper``, ``log_gf``, ``A_s1`` and ``wl_vac_nm``, sorted by
        ``E_lower_cm`` then ``E_upper_cm``.
    """
    rows: list[dict[str, float]] = []

    with open(lines_path, "r", encoding="ascii", errors="replace") as fh:
        for line in fh:
            rec = _parse_record(line)
            if rec is None:
                continue  # defensive: skip malformed records

            e_low = rec["E_lower_stored"]
            # AMBIGUITY: the description says "stored lower energy > 0", but the
            # ground state is stored as exactly 0.000 cm^-1 and is the most
            # important bound target state.  Bound levels are the non-negative
            # ones; autoionizing levels are the negative ones, so we keep
            # e_low >= 0 and drop e_low < 0.
            if e_low < 0.0:
                continue  # autoionizing lower level -> touches no bound target

            wl_vac_nm = _air_to_vac_nm(rec["wl_air_nm"])

            if rec["E_upper_stored"] < 0.0:
                # Autoionizing upper level: stored magnitude is not the
                # absolute energy; reconstruct from the lower level + photon
                # energy dE = 1e7 / lambda_vac [cm^-1].
                e_up = e_low + 1e7 / wl_vac_nm
            else:
                # Bound upper level: stored value is the absolute energy.
                e_up = rec["E_upper_stored"]

            j_up = rec["J_upper"]
            gf = 10.0 ** rec["log_gf"]
            lam_angstrom = wl_vac_nm * 10.0
            a_s1 = _A_PREFACTOR / (lam_angstrom ** 2) * gf / (2.0 * j_up + 1.0)

            rows.append(
                {
                    "E_lower_cm": e_low,
                    "E_upper_cm": e_up,
                    "J_lower": rec["J_lower"],
                    "J_upper": j_up,
                    "log_gf": rec["log_gf"],
                    "A_s1": a_s1,
                    "wl_vac_nm": wl_vac_nm,
                }
            )

    rows.sort(key=lambda r: (r["E_lower_cm"], r["E_upper_cm"]))
    return rows
