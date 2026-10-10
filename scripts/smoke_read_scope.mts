#!/usr/bin/env tsx
/**
 * Smoke: tool_impl / tool_review read-scope enforcement.
 *
 * Creates a fake project with a notes/ file + an experiment dir, applies
 * wrapToolImplTools with EXPERIMENT_ID=E_test, and asserts:
 *   - read inside data/experiments/E_test/ → succeeds
 *   - read of notes/literature.md → BLOCKED
 *   - read of an absolute path outside projectDir → BLOCKED
 * and (C29) that `read` in the coding and pi tool sets returns a PDF's text layer.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { buildSafetyWrapper } from "../src/agents/safety-wrappers.js";
import { getDefinition } from "../src/agents/registry.js";
import { resolveToolSets } from "../src/agents/tool-sets.js";

const wrapToolImplTools = buildSafetyWrapper(getDefinition("tool_impl").safety);
if (!wrapToolImplTools) throw new Error("tool_impl.md must declare a safety config for this smoke to run");

const dir = mkdtempSync(join(tmpdir(), "smoke-read-scope-"));
mkdirSync(join(dir, "notes"));
mkdirSync(join(dir, "data/experiments/E_test/scripts"), { recursive: true });
writeFileSync(join(dir, "notes/literature.md"), "secret literature");
writeFileSync(join(dir, "data/experiments/E_test/scripts/helper.py"), "print('ok')");

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.log(`FAIL ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
};

// Minimal fake read tool mirroring pi-coding-agent signature.
const fakeRead = {
  name: "read",
  execute: async (_id: string, params: any) => ({
    content: [{ type: "text" as const, text: `READ_OK:${params.path}` }],
  }),
};

const wrapped = wrapToolImplTools([fakeRead], dir, { EXPERIMENT_ID: "E_test" });
const read = wrapped[0];

async function run() {
  // Inside scope — succeeds
  const ok = await read.execute("1", { path: "data/experiments/E_test/scripts/helper.py" });
  const okText = ok.content[0].text;
  assert(okText.startsWith("READ_OK"), "read inside experiment dir succeeds");

  // Outside scope — blocked
  const notes = await read.execute("2", { path: "notes/literature.md" });
  const notesText = notes.content[0].text;
  assert(notesText.startsWith("BLOCKED"), "read of notes/literature.md blocked");
  assert(notesText.includes("data/experiments/E_test"), "block message names allowed dir");

  // Sibling experiment — blocked
  const sibling = await read.execute("3", { path: "data/experiments/E_other/scripts/x.py" });
  assert(sibling.content[0].text.startsWith("BLOCKED"), "read of sibling experiment blocked");

  // Escape via .. — resolved and blocked
  const escape = await read.execute("4", { path: "data/experiments/E_test/../../notes/literature.md" });
  assert(escape.content[0].text.startsWith("BLOCKED"), "path with .. escape blocked after resolve");

  // Absolute path outside projectDir — blocked
  const abs = await read.execute("5", { path: "/etc/passwd" });
  assert(abs.content[0].text.startsWith("BLOCKED"), "absolute path outside projectDir blocked");
}

// Fail-closed: wrapper with no templateVars should block all reads (EXPERIMENT_ID stays literal).
async function failClosed() {
  const wrappedNoVars = wrapToolImplTools([fakeRead], dir);
  const readNoVars = wrappedNoVars[0];
  const r = await readNoVars.execute("10", { path: "data/experiments/E_test/scripts/helper.py" });
  assert(r.content[0].text.startsWith("BLOCKED"), "missing EXPERIMENT_ID fails closed (no reads allowed)");
}

// tool_impl is blind to the tests it is judged by (it fixes failures from the
// pytest output the parent relays). The allowed root is the whole experiment
// dir, so this needs the deny-list — and the bash path, the lazy way round it.
async function blindToTests() {
  mkdirSync(join(dir, "data/experiments/E_test/tests"), { recursive: true });
  writeFileSync(join(dir, "data/experiments/E_test/tests/test_helper.py"), "def test_x(): assert True");
  const fakeBash = { name: "bash", execute: async (_id: string, params: any) => ({ content: [{ type: "text" as const, text: `BASH_OK:${params.command}` }] }) };
  const [r, b] = wrapToolImplTools!([fakeRead, fakeBash], dir, { EXPERIMENT_ID: "E_test" });
  const t = await r.execute("20", { path: "data/experiments/E_test/tests/test_helper.py" });
  assert(t.content[0].text.startsWith("BLOCKED"), "tool_impl read of tests/ blocked (deny wins over the allowed root)");
  const viaDots = await r.execute("21", { path: "data/experiments/E_test/scripts/../tests/test_helper.py" });
  assert(viaDots.content[0].text.startsWith("BLOCKED"), "…also through a .. path");
  const own = await r.execute("22", { path: "data/experiments/E_test/scripts/helper.py" });
  assert(own.content[0].text.startsWith("READ_OK"), "its own scripts/ stay readable");
  const cat = await b.execute("23", { command: "cat data/experiments/E_test/tests/test_helper.py" });
  assert(cat.content[0].text.startsWith("BLOCKED"), "tool_impl bash that names tests/ blocked");
  const ok = await b.execute("24", { command: "python data/experiments/E_test/scripts/helper.py" });
  assert(ok.content[0].text.startsWith("BASH_OK"), "bash on its own scripts/ still runs");
}

// No definition ships without a safety config: an agent holding write/bash with
// none could overwrite RESEARCH.md (seven did until 2026-10-05).
async function everyAgentGuarded() {
  const { loadAgentDefinitions } = await import("../src/agents/registry.js");
  const all: any = loadAgentDefinitions();
  const defs: any[] = all instanceof Map ? [...all.values()] : Array.isArray(all) ? all : Object.values(all);
  assert(defs.length >= 20, `loaded ${defs.length} agent definitions`);
  const bare = defs.filter((d) => !d.safety).map((d) => d.name);
  assert(bare.length === 0, `every definition declares safety${bare.length ? ` — missing: ${bare.join(", ")}` : ""}`);
  writeFileSync(join(dir, "RESEARCH.md"), "the human's goal");
  const fakeWrite = { name: "write", execute: async () => ({ content: [{ type: "text" as const, text: "WRITE_OK" }] }) };
  const fakeEdit = { name: "edit", execute: async () => ({ content: [{ type: "text" as const, text: "EDIT_OK" }] }) };
  const leaks: string[] = [];
  for (const d of defs) {
    const wrap = buildSafetyWrapper(d.safety);
    if (!wrap) continue;
    const [w, e, r] = wrap([fakeWrite, fakeEdit, fakeRead], dir, { EXPERIMENT_ID: "E_test" });
    await r.execute("30", { path: "RESEARCH.md" }); // a prior read must not unlock the write
    const wr = await w.execute("31", { path: "RESEARCH.md", content: "x" });
    const ed = await e.execute("32", { path: "RESEARCH.md", edits: [{ oldText: "goal", newText: "x" }] });
    if (wr.content[0].text === "WRITE_OK" || ed.content[0].text === "EDIT_OK") leaks.push(d.name);
  }
  assert(leaks.length === 0, `no agent can write RESEARCH.md${leaks.length ? ` — can: ${leaks.join(", ")}` : ""}`);
}

// C29: `read` on a PDF returned its raw bytes (~100 KB of noise that rode along
// in context), and the PI reviewer has no bash to extract text. Both tool sets
// that carry `read` must return the text layer instead. The content stream is
// Flate-compressed and the digits are drawn per run, so only real extraction
// can produce them — an uncompressed fixture would show them in the raw bytes.
function flatePdf(contentStream: string): Buffer {
  const stream = deflateSync(Buffer.from(contentStream, "latin1"));
  const parts: Buffer[] = [];
  const offs: number[] = [];
  let len = 0;
  const push = (b: Buffer | string) => {
    const x = typeof b === "string" ? Buffer.from(b, "latin1") : b;
    parts.push(x); len += x.length;
  };
  push("%PDF-1.4\n");
  const objs: (string | Buffer[])[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    [Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), stream, Buffer.from("\nendstream", "latin1")],
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  objs.forEach((o, i) => {
    offs.push(len);
    push(`${i + 1} 0 obj\n`);
    if (typeof o === "string") push(o); else o.forEach(push);
    push("\nendobj\n");
  });
  const xref = len;
  push(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`);
  for (const o of offs) push(`${String(o).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

async function pdfReadsReturnText() {
  const pdir = mkdtempSync(join(tmpdir(), "smoke-read-pdf-"));
  let digits = "";
  let pdf: Buffer = Buffer.alloc(0);
  do {
    digits = String(10000 + Math.floor(Math.random() * 90000));
    pdf = flatePdf(`BT /F1 24 Tf 72 72 Td (${digits}) Tj ET`);
  } while (pdf.includes(digits)); // e.g. 65535 sits in the xref
  writeFileSync(join(pdir, "paper.pdf"), pdf);
  writeFileSync(join(pdir, "scan.pdf"), flatePdf("0 0 1 rg 10 10 100 100 re f"));
  const note = "line one\n%PDF- is only text here\n12345\n";
  writeFileSync(join(pdir, "note.txt"), note);

  const readVia = async (tool: any, path: string) => {
    try {
      const r = await tool.execute("c29", { path });
      return { ok: !r.isError, text: r.content.map((c: any) => c.text ?? "").join("") };
    } catch (e: any) {
      return { ok: false, text: String(e?.message ?? e) };
    }
  };
  const haveBin = !spawnSync("pdftotext", ["-v"]).error;
  if (!haveBin) console.log("  (C29 skip) pdftotext not on PATH — text-layer checks skipped");

  for (const set of ["coding", "pi"]) {
    const read = resolveToolSets([set], pdir).find((t: any) => t.name === "read");
    assert(!!read, `[C29 ${set}] tool set carries read`);
    if (!read) continue;
    assert(/PDF returns its text layer/.test(read.description ?? ""), `[C29 ${set}] read's description says a PDF returns its text layer`);

    if (haveBin) {
      const r = await readVia(read, "paper.pdf");
      assert(r.ok && !r.text.startsWith("%PDF-") && r.text.includes(digits),
        `[C29 ${set}] (i) read on a Flate PDF returns its text layer (got ${JSON.stringify(r.text.slice(0, 40))})`);
      const s = await readVia(read, "scan.pdf");
      assert(!s.ok && /no text layer/.test(s.text) && /pdftoppm/.test(s.text),
        `[C29 ${set}] (i') a PDF without a text layer errors and points at pdftoppm (got ${JSON.stringify(s.text.slice(0, 60))})`);
    }

    const emptyBin = mkdtempSync(join(tmpdir(), "smoke-read-nopath-"));
    const savedPath = process.env.PATH;
    process.env.PATH = emptyBin;
    let m: { ok: boolean; text: string };
    try { m = await readVia(read, "paper.pdf"); }
    finally { process.env.PATH = savedPath; rmSync(emptyBin, { recursive: true, force: true }); }
    assert(!m.ok && /pdftotext/.test(m.text) && !m.text.startsWith("%PDF-") && !m.text.includes("endobj"),
      `[C29 ${set}] (ii) without pdftotext the read errors, names pdftotext, and is not raw bytes (got ${JSON.stringify(m.text.slice(0, 60))})`);

    const t = await readVia(read, "note.txt");
    assert(t.ok && t.text === note, `[C29 ${set}] (iii) a .txt file still reads unchanged`);
  }
  rmSync(pdir, { recursive: true, force: true });
}

await run();
await failClosed();
await blindToTests();
await everyAgentGuarded();
await pdfReadsReturnText();

rmSync(dir, { recursive: true, force: true });

if (failures === 0) {
  console.log("\nPASS — tool_impl read-scope enforcement works");
  process.exit(0);
} else {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
