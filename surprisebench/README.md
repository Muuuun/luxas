# surprisebench — planted-surprise benches

Each task asks for a quantity X. In the planted variants (`s*`) the data or
code hide a phenomenon the task never mentions; the clean variants (`c*`) are
the same tasks without it. Scored by stage: noticed, artifact ruled out,
scoped, mechanism, X still right, a new question. Clean variants are scored
for false alarms. Design, arms and the pre-written decision lines:
`notes/surprise-ruler-design-2026-10-22.md`.

| variant | X | planted |
|---|---|---|
| s1-ringdown / c1 | Q of a 1 kHz torsion mode | a second mode 0.8 Hz away (beats) |
| s2-orbit / c2 | apsidal precession with the group's integrator | stale acceleration in the second half-kick |
| s3-lc-sweep | f0 and loaded Q for three capacitors | a fixture resonance at 21.94 MHz that does not tune |
| s4-rod-kappa | conductivity of a CP-Ti rod | radiative loss from the hot end in vacuum |
| s5-halflife / c5 | half-life of 128-I | GM counter dead time at 8000 counts/s |
| s6-pendulum | period and damping of a 2.4 m pendulum | Foucault rotation of the swing plane |

Not in `benchmarks/`: `reflect_ab.mts` runs every directory there for up to 40
billable minutes.

```bash
python3 surprisebench/_lib/generate.py            # write <variant>/input/ (deterministic, not in git)
python3 surprisebench/_lib/generate.py --check    # oracle.json still matches the generator
env -u ANTHROPIC_API_KEY npx tsx scripts/bench_run.mts --arm claude-code --bench-root surprisebench --bench s5-halflife
npx tsx scripts/surprise_score.mts <run-dir> --bench s5-halflife --arm claude-code   # judges: DeepSeek + GLM (paid)
npx tsx scripts/surprise_score.mts --validate     # the judges on surprisebench/_validation/cases.json
```

The run directory gets only `RESEARCH.md` and `input/`; `oracle.json`, the
generator and the cases stay here. Scores go to `<run-dir>/surprise_score.json`
and `SCORES.jsonl`.
