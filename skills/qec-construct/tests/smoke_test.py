#!/usr/bin/env python3
"""Tiny regression anchor for qverify (written AFTER the soundness fix, to lock it).

Fast: CSS + k + cheap screen for all 11 published Menon codes (no exact ILP), one
full exact certification ([[48,6,4]]), and THE soundness regression: a non-abelian
code with no gate check must NOT print CERTIFIED. Run: python3 tests/smoke_test.py
"""
import sys, os, re, random
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
sys.path.insert(0, os.path.join(HERE, "..", "scripts", "kernel"))
from importlib.machinery import SourceFileLoader
qv = SourceFileLoader("qv", os.path.join(HERE, "..", "scripts", "qverify")).load_module()
from group import Group, construct_tricycle_general

VARS = {"x": 0, "y": 1, "z": 2}
def pp(s, o):
    out = []
    for t in s.replace(" ", "").split("+"):
        e = [0, 0, 0]
        for m in re.finditer(r"([xyz])(\^?\{?(\d+)\}?)?", t):
            e[VARS[m.group(1)]] = int(m.group(3)) if m.group(3) else 1
        out.append([x % d for x, d in zip(e, o)])
    return out

# (N, K, D_Z, (l,m,n), a, b, c)
CODES = [
    (48,6,4,(2,2,4),"y+z+xz+xyz^2","yz^2+yz^3","y+xyz"),
    (84,6,5,(2,2,7),"y+z+xz+xyz^2","z^3+xz^4","y+yz^4"),
    (108,6,6,(3,3,4),"x+z^2+yz+x^2yz^3","y^2z+x^2yz^3","x^2+x^2yz^2"),
    (108,12,4,(3,3,4),"z+xz^3+xyz^2+x^2y","y^2+y^2z^3+xy^2z+xy^2z^2","z+xyz^3"),
    (108,15,6,(3,3,4),"y+y^2z+xyz^3+x^2y^2z^2","z^2+xy+xy^2z+x^2z^3","yz^3+y^2z+x^2+x^2y^2z^2"),
    (180,12,6,(3,4,5),"yz^3+y^3+x^2yz^3+x^2y^3z","xyz^4+xy^2z^2+x^2yz+x^2y^2z^4","z^4+x^2z"),
    (240,6,8,(4,4,5),"xy^2z^3+xy^3z^4+x^2y^2z+x^2y^3z^2","y^3+x^2yz^2","xz^4+x^3y^3z"),
    (270,24,8,(3,5,6),"z^4+y^3+xy^2+x^2yz^4","y^3+y^3z+xy^4+x^2y^2z","yz^4+y^2z+xy^2z+xy^3z^4"),
    (480,6,10,(4,5,8),"x^2z^7+x^3y^2+y^4z^4+xy^3z^3","z^6+x^2y^2z^2","x^2+x^3y^4z"),
    (324,12,12,(3,4,9),"y^2z+xyz+x^2z^6+x^2y^3z^5","z^4+z^5+xyz^7+x^2y^3z^2","yz^7+xz^7+xy^3+x^2y^2"),
    (480,15,14,(4,5,8),"x^2z^5+x^2yz^4+x^3y^3z^4+x^3y^4z^3","x^2z^3+x^2y^4z^6+x^3z^5+x^3yz^2","yz^5+xz^4+x^2y^4z^4+x^3y^2z^5"),
]

fails = []

# 1. all 11 codes: css valid, k matches published, screen does not falsely reject
for N, K, DZ, o, a, b, c in CODES:
    fom = K * DZ ** 3 / N
    spec = {"family": "abelian", "group_shape": list(o),
            "supp_a": pp(a, o), "supp_b": pp(b, o), "supp_c": pp(c, o),
            "frontier_fom": round(fom * 0.99, 3), "screen_iters": 120}
    out = qv.verify(spec)
    if not out.get("css_valid"):
        fails.append(f"[[{N},{K}]] css_valid False")
    if out.get("k") != K:
        fails.append(f"[[{N},{K}]] k={out.get('k')} != {K}")
    if out.get("screen", {}).get("verdict") == "reject":
        fails.append(f"[[{N},{K}]] screen falsely rejected a real frontier code")

# 2. full certification path still works ([[48,6,4]], fast exact)
spec48 = {"family": "abelian", "group_shape": [2, 2, 4],
          "supp_a": pp("y+z+xz+xyz^2", (2,2,4)), "supp_b": pp("yz^2+yz^3", (2,2,4)), "supp_c": pp("y+xyz", (2,2,4)),
          "partition_a": [[[0,1,0],[0,0,1]], [[1,0,1],[1,1,2]]],
          "partition_b": [[[0,1,2]], [[0,1,3]]], "partition_c": [[[0,1,0]], [[1,1,1]]],
          "frontier_fom": 1.0, "exact": True, "ilp_timeout": 60}
o48 = qv.verify(spec48)
if "*** CERTIFIED" not in o48["verdict"]:
    fails.append(f"[[48,6,4]] legit certification BROKE: {o48['verdict'][:80]}")

# 3. THE soundness regression: a non-abelian code with no gate check must NOT certify
D = Group.dihedral(3); rng = random.Random(1); na = None
for _ in range(80):
    sa = rng.sample(range(D.n), 4); sb = rng.sample(range(D.n), 4); sc = rng.sample(range(D.n), 2)
    code = construct_tricycle_general(D, sa, sb, sc)
    if code["css_verified"] and code["k"] >= 1:
        na = (sa, sb, sc); break
ona = qv.verify({"family": "general", "group": {"kind": "dihedral", "n": 3},
                 "supp_a": na[0], "supp_b": na[1], "supp_c": na[2],
                 "frontier_fom": 0.01, "exact": True, "ilp_timeout": 60})
if "*** CERTIFIED" in ona["verdict"]:
    fails.append(f"SOUNDNESS REGRESSION: non-abelian falsely CERTIFIED: {ona['verdict'][:80]}")

if fails:
    print("FAIL:"); [print("  -", f) for f in fails]; sys.exit(1)
print(f"PASS: 11 Menon codes css/k/screen OK; [[48,6,4]] certifies; non-abelian correctly NOT certified.")
