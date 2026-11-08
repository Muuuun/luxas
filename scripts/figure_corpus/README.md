# figure_corpus — how skills/figure/references/figure_types.md was measured

Run on the droplet (PyMuPDF venv; `nice`, 2 workers), never on the Mac mini:

    python extract2.py OUT <dir with */data/papers/> [...] --workers 2   # one row per figure file → OUT/rows.jsonl, crops of level diagrams
    python eps_pass.py OUT                                               # EPS figures via epstopdf → OUT/rows_eps.jsonl
    python analyze.py  rows_all.jsonl      # per figure type: text / horizontal segments / stroke neutral share, pixels
    python analyze2.py rows_all.jsonl      # data figures: text colour, hue families, pale fills, default-palette fingerprints
    python analyze3.py rows_all.jsonl      # by figure position; colour reuse across the figures of one paper

`extract_figs.py` holds the shared measuring code (vector colours from PDF drawing commands, text span
colours, 40-dpi pixel statistics). Level diagrams were then read one by one from the crops; the
per-diagram record is `skills/figure/references/level_diagram_tally.tsv` (src, id, level colour,
reason for colour, drive colour, drive-label colour, other text colour, note).

2026-11-07 run: 1,168 papers, 10,597 figure files; results in `~/figstyle-2026-11/full/` on the droplet.
Crops are cut from published papers — they stay on the droplet and are never committed.
