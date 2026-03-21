#!/usr/bin/env node
/**
 * Sisyphus Operations Monitor — Rule Engine (Layer 0)
 *
 * Reads .agent/log.jsonl + project artifacts, runs pattern detectors,
 * outputs structured JSON report. READ-ONLY — never modifies project files.
 *
 * Usage:
 *   node monitor/analyze.js <project-dir>
 *   node monitor/analyze.js <project-dir> --full    # post-run comprehensive
 *   node monitor/analyze.js <project-dir> --json    # machine-readable output
 *
 * State stored in <project-dir>/.monitor/state.json (only file written outside stdout)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const projectDir = process.argv[2];
if (!projectDir || projectDir.startsWith("--")) {
  console.error("Usage: node monitor/analyze.js <project-dir> [--full] [--json]");
  process.exit(1);
}

const fullMode = process.argv.includes("--full");
const jsonMode = process.argv.includes("--json");
const absDir = path.resolve(projectDir);

// ─── Helpers ──────────────────────────────────────────────

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
  const entries = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch { /* partial line — skip */ }
  }
  return entries;
}

function argsHash(args) {
  // Sort keys for deterministic hashing, but use a replacer function
  // (not an array) to avoid stripping nested keys at all levels
  return crypto.createHash("md5").update(JSON.stringify(args ?? {}, (key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const sorted = {};
      for (const k of Object.keys(value).sort()) sorted[k] = value[k];
      return sorted;
    }
    return value;
  })).digest("hex").slice(0, 10);
}

function normalizeDoi(doi) {
  // Normalize DOI for fuzzy matching: lowercase, replace / and _ with .
  return doi.toLowerCase().replace(/[/_]/g, ".").replace(/[;:.]+$/, "");
}

function fileExists(rel) {
  return fs.existsSync(path.join(absDir, rel));
}

function lineCount(rel) {
  const p = path.join(absDir, rel);
  if (!fs.existsSync(p)) return 0;
  return fs.readFileSync(p, "utf-8").split("\n").length;
}

function fileSize(rel) {
  const p = path.join(absDir, rel);
  if (!fs.existsSync(p)) return 0;
  return fs.statSync(p).size;
}

function listDir(rel) {
  const p = path.join(absDir, rel);
  if (!fs.existsSync(p)) return [];
  return fs.readdirSync(p);
}

// ─── State Management ─────────────────────────────────────

const monitorDir = path.join(absDir, ".monitor");
const statePath = path.join(monitorDir, "state.json");

function loadState() {
  if (!fs.existsSync(statePath)) return { lastLogLine: 0, findings: [] };
  try { return JSON.parse(fs.readFileSync(statePath, "utf-8")); } catch { return { lastLogLine: 0, findings: [] }; }
}

function saveState(state) {
  fs.mkdirSync(monitorDir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// ─── Detectors ────────────────────────────────────────────

function detectGenericRepeat(entries, window = 10, threshold = 3) {
  const issues = [];
  for (let i = 0; i <= entries.length - window; i++) {
    const w = entries.slice(i, i + window);
    const counts = {};
    for (const e of w) {
      const key = `${e.tool}|${argsHash(e.args)}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    for (const [key, count] of Object.entries(counts)) {
      if (count >= threshold) {
        const tool = key.split("|")[0];
        // Deduplicate — only report first occurrence
        const existing = issues.find(i => i.tool === tool && i.argsHash === key.split("|")[1]);
        if (!existing) {
          const argsSample = w.find(e => `${e.tool}|${argsHash(e.args)}` === key)?.args;
          const argPreview = JSON.stringify(argsSample ?? {}).slice(0, 100);
          issues.push({
            detector: "genericRepeat",
            severity: count >= 5 ? "problem" : "warning",
            tool,
            argsHash: key.split("|")[1],
            count,
            window,
            timestamp: entries[i].timestamp,
            message: `${tool} called ${count}x with same args in ${window} calls: ${argPreview}`,
          });
        }
      }
    }
  }
  return issues;
}

function detectStuckLoop(entries, window = 15, threshold = 5) {
  return detectGenericRepeat(entries, window, threshold).map(i => ({
    ...i,
    detector: "stuckLoop",
    severity: "problem",
  }));
}

function detectPingPong(entries) {
  const issues = [];
  for (let i = 0; i < entries.length - 3; i++) {
    const a = `${entries[i].tool}|${argsHash(entries[i].args)}`;
    const b = `${entries[i + 1].tool}|${argsHash(entries[i + 1].args)}`;
    if (a === b) continue; // not alternating
    const c = `${entries[i + 2].tool}|${argsHash(entries[i + 2].args)}`;
    const d = `${entries[i + 3].tool}|${argsHash(entries[i + 3].args)}`;
    if (a === c && b === d) {
      const existing = issues.find(is => is.pairKey === `${a}<>${b}`);
      if (!existing) {
        issues.push({
          detector: "pingPong",
          severity: "warning",
          pairKey: `${a}<>${b}`,
          timestamp: entries[i].timestamp,
          message: `Ping-pong: ${entries[i].tool} <-> ${entries[i + 1].tool} oscillation`,
        });
      }
    }
  }
  return issues;
}

function detectSilentFail(entries) {
  const issues = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].success === false) {
      const failedTool = entries[i].tool;
      // Check next 3 calls for retry or alternative
      const next3 = entries.slice(i + 1, i + 4);
      const hasRetry = next3.some(e => e.tool === failedTool);
      const hasAlternative = next3.some(e => e.tool !== failedTool && e.tool !== "bash");
      if (!hasRetry && !hasAlternative && next3.length >= 2) {
        issues.push({
          detector: "silentFail",
          severity: "problem",
          tool: failedTool,
          timestamp: entries[i].timestamp,
          message: `${failedTool} failed but no retry or alternative in next ${next3.length} calls`,
          args: JSON.stringify(entries[i].args ?? {}).slice(0, 120),
        });
      }
    }
  }
  return issues;
}

function detectNoProgress(entries, threshold = 10) {
  const issues = [];
  const writingTools = new Set(["write", "edit", "compile_latex", "dispatch_workers", "run_experiment"]);
  let streak = 0;
  let streakStart = null;
  for (let i = 0; i < entries.length; i++) {
    if (writingTools.has(entries[i].tool)) {
      if (streak >= threshold) {
        issues.push({
          detector: "noProgress",
          severity: "warning",
          streak,
          timestamp: streakStart,
          message: `${streak} consecutive calls with no write/edit/compile (all reads/bash)`,
        });
      }
      streak = 0;
      streakStart = null;
    } else {
      if (streak === 0) streakStart = entries[i].timestamp;
      streak++;
    }
  }
  // Check trailing streak
  if (streak >= threshold) {
    issues.push({
      detector: "noProgress",
      severity: "warning",
      streak,
      timestamp: streakStart,
      message: `${streak} consecutive calls with no write/edit/compile (all reads/bash) — ongoing`,
    });
  }
  return issues;
}

// ─── Artifact Analysis ────────────────────────────────────

function analyzeArtifacts() {
  const papers = listDir("data/papers");
  const paperCount = papers.length;

  // Validate downloaded PDFs
  const validPdfs = [];
  const invalidFiles = [];
  for (const f of papers) {
    const fullPath = path.join(absDir, "data/papers", f);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      // Skip _figures directories (created by extract-figures skill)
      if (f.endsWith("_figures")) continue;
      // arXiv LaTeX source — check for .tex files
      const hasTeX = fs.readdirSync(fullPath).some(x => x.endsWith(".tex"));
      if (hasTeX) validPdfs.push({ file: f, type: "latex_source" });
      else invalidFiles.push({ file: f, reason: "directory without .tex files" });
    } else if (f.endsWith(".pdf")) {
      // Check PDF magic bytes
      try {
        const buf = Buffer.alloc(5);
        const fd = fs.openSync(fullPath, "r");
        fs.readSync(fd, buf, 0, 5, 0);
        fs.closeSync(fd);
        if (buf.toString() === "%PDF-") {
          validPdfs.push({ file: f, type: "pdf", size: stat.size });
        } else {
          invalidFiles.push({ file: f, reason: `not a PDF (header: ${buf.toString()})`, size: stat.size });
        }
      } catch {
        invalidFiles.push({ file: f, reason: "could not read" });
      }
    } else if (f.endsWith(".txt")) {
      // Ignore .txt companion files
    } else if (f.endsWith(".html")) {
      invalidFiles.push({ file: f, reason: "HTML file (failed Sci-Hub download)", size: stat.size });
    } else {
      invalidFiles.push({ file: f, reason: "unknown file type" });
    }
  }

  // DOIs in literature.md
  const litPath = path.join(absDir, "notes/literature.md");
  let litDois = [];
  let litArxivIds = [];
  if (fs.existsSync(litPath)) {
    const content = fs.readFileSync(litPath, "utf-8");
    const doiMatches = content.match(/10\.\d{4,}\/[^\s,);]+/g) || [];
    litDois = [...new Set(doiMatches.map(d => d.replace(/[;:.]+$/, "").toLowerCase()))];
    // Also extract arXiv IDs (e.g., 2306.09756, 2104.02396)
    const arxivMatches = content.match(/\b(\d{4}\.\d{4,5})\b/g) || [];
    litArxivIds = [...new Set(arxivMatches)];
  }

  // Downloaded files — normalize DOI filenames for fuzzy match
  const downloadedNorm = papers
    .filter(f => f.startsWith("10_"))
    .map(f => normalizeDoi(f.replace(/\.(pdf|html|txt)$/, "")));

  // Also track arXiv downloads (directories or .pdf files with arXiv ID pattern)
  const downloadedArxiv = papers
    .filter(f => /^\d{4}\.\d{4,5}/.test(f))
    .map(f => f.replace(/\.(pdf|txt)$/, ""));

  // Cross-reference DOIs: normalize both sides
  const missingDois = litDois.filter(doi => {
    const norm = normalizeDoi(doi);
    return !downloadedNorm.some(dd => norm.includes(dd) || dd.includes(norm));
  });

  // Cross-reference arXiv IDs
  const missingArxiv = litArxivIds.filter(aid =>
    !downloadedArxiv.some(da => da.startsWith(aid) || aid.startsWith(da))
  );

  const totalCited = litDois.length + litArxivIds.length;
  const totalDownloaded = downloadedNorm.length + downloadedArxiv.length;
  const totalMissing = missingDois.length + missingArxiv.length;

  return {
    papers: {
      total: paperCount,
      validPdfs: validPdfs.length,
      invalidFiles,
      downloadedCount: totalDownloaded,
    },
    literature: {
      lines: lineCount("notes/literature.md"),
      citedDois: litDois.length,
      citedArxiv: litArxivIds.length,
      totalCited,
      totalDownloaded,
      totalMissing,
      missingDoisSample: [...missingDois.slice(0, 5), ...missingArxiv.slice(0, 5)],
    },
    experiments: { lines: lineCount("notes/experiments.md") },
    report: {
      texLines: lineCount("report/report.tex"),
      pdfSize: fileSize("report/report.pdf"),
      pdfExists: fileExists("report/report.pdf"),
      figures: listDir("report/figures").filter(f => /\.(pdf|png|svg)$/i.test(f)),
    },
  };
}

// ─── Phase Detection (full mode) ──────────────────────────

function detectPhases(entries) {
  if (entries.length === 0) return [];
  const phases = [];
  let currentPhase = null;

  function classifyTool(entry) {
    const t = entry.tool;
    const args = JSON.stringify(entry.args ?? {});
    if (t === "dispatch_workers" && args.includes("search")) return "search";
    if (t === "dispatch_workers" && args.includes("ownload")) return "download";
    if (t === "dispatch_workers" && (args.includes("ead") || args.includes("extract"))) return "read";
    if (t === "dispatch_workers") return "dispatch";
    if (t === "run_experiment") return "experiment";
    if (t === "compile_latex") return "compile";
    if (t === "request_pi_review") return "review";
    if (t === "write" && args.includes("report")) return "write_report";
    if (t === "write" && args.includes("literature")) return "write_notes";
    if (t === "write" || t === "edit") return "write";
    if (t === "read") return "read";
    return "other";
  }

  for (const entry of entries) {
    const phase = classifyTool(entry);
    if (phase !== currentPhase) {
      if (phases.length > 0) {
        phases[phases.length - 1].endTime = entry.timestamp;
        phases[phases.length - 1].endIndex = entries.indexOf(entry) - 1;
      }
      currentPhase = phase;
      phases.push({
        phase: currentPhase,
        startTime: entry.timestamp,
        startIndex: entries.indexOf(entry),
        endTime: entry.timestamp,
        endIndex: entries.indexOf(entry),
        toolCalls: 0,
      });
    }
    phases[phases.length - 1].toolCalls++;
    phases[phases.length - 1].endTime = entry.timestamp;
    phases[phases.length - 1].endIndex = entries.indexOf(entry);
  }

  // Merge consecutive same-phase segments
  const merged = [];
  for (const p of phases) {
    const last = merged[merged.length - 1];
    if (last && last.phase === p.phase) {
      last.endTime = p.endTime;
      last.endIndex = p.endIndex;
      last.toolCalls += p.toolCalls;
    } else {
      merged.push({ ...p });
    }
  }

  // Absorb tiny phases (1-2 calls) of type "other" into neighbors
  const absorbed = [];
  for (let i = 0; i < merged.length; i++) {
    const p = merged[i];
    if (p.phase === "other" && p.toolCalls <= 2 && absorbed.length > 0) {
      // Merge into previous phase
      absorbed[absorbed.length - 1].endTime = p.endTime;
      absorbed[absorbed.length - 1].endIndex = p.endIndex;
      absorbed[absorbed.length - 1].toolCalls += p.toolCalls;
    } else {
      absorbed.push({ ...p });
    }
  }

  // Second pass: merge consecutive same-phase after absorption
  const final = [];
  for (const p of absorbed) {
    const last = final[final.length - 1];
    if (last && last.phase === p.phase) {
      last.endTime = p.endTime;
      last.endIndex = p.endIndex;
      last.toolCalls += p.toolCalls;
    } else {
      final.push({ ...p });
    }
  }

  // Add duration
  for (const p of final) {
    const start = new Date(p.startTime).getTime();
    const end = new Date(p.endTime).getTime();
    p.durationSec = Math.round((end - start) / 1000);
  }

  return final;
}

// ─── Tool Call Statistics ─────────────────────────────────

function computeStats(entries) {
  const byTool = {};
  let failures = 0;
  for (const e of entries) {
    byTool[e.tool] = (byTool[e.tool] || 0) + 1;
    if (e.success === false) failures++;
  }

  const totalTime = entries.length >= 2
    ? Math.round((new Date(entries[entries.length - 1].timestamp).getTime() -
        new Date(entries[0].timestamp).getTime()) / 1000)
    : 0;

  return {
    totalCalls: entries.length,
    failures,
    failureRate: entries.length > 0 ? (failures / entries.length * 100).toFixed(1) + "%" : "0%",
    byTool: Object.entries(byTool).sort((a, b) => b[1] - a[1]).reduce((o, [k, v]) => (o[k] = v, o), {}),
    totalTimeSec: totalTime,
  };
}

// ─── Main ─────────────────────────────────────────────────

const logPath = path.join(absDir, ".agent/log.jsonl");
const allEntries = readJsonLines(logPath);
const state = loadState();

// Determine which entries to analyze
const newEntries = fullMode ? allEntries : allEntries.slice(state.lastLogLine);
const windowEntries = fullMode ? allEntries : allEntries.slice(Math.max(0, allEntries.length - 50));

// Run detectors
const issues = [
  ...detectGenericRepeat(windowEntries),
  ...detectStuckLoop(windowEntries),
  ...detectPingPong(windowEntries),
  ...detectSilentFail(windowEntries),
  ...detectNoProgress(windowEntries),
];

// Deduplicate stuckLoop vs genericRepeat (stuckLoop is stricter)
const stuckKeys = new Set(issues.filter(i => i.detector === "stuckLoop").map(i => `${i.tool}|${i.argsHash}`));
const dedupedIssues = issues.filter(i => {
  if (i.detector === "genericRepeat" && stuckKeys.has(`${i.tool}|${i.argsHash}`)) return false;
  return true;
});

// Artifact analysis
const artifacts = analyzeArtifacts();

// Add artifact-level issues
if (artifacts.papers.invalidFiles.length > 0) {
  for (const f of artifacts.papers.invalidFiles) {
    dedupedIssues.push({
      detector: "invalidDownload",
      severity: "problem",
      message: `${f.file}: ${f.reason}`,
    });
  }
}

if (artifacts.literature.totalMissing > 5) {
  dedupedIssues.push({
    detector: "downloadGap",
    severity: "warning",
    message: `${artifacts.literature.totalCited} references cited in literature.md, ${artifacts.literature.totalDownloaded} downloaded, ${artifacts.literature.totalMissing} not found locally`,
    sample: artifacts.literature.missingDoisSample,
  });
}

// Stats
const stats = computeStats(fullMode ? allEntries : newEntries);

// Phases (full mode only)
const phases = fullMode ? detectPhases(allEntries) : [];

// Build report
const report = {
  project: path.basename(absDir),
  projectDir: absDir,
  timestamp: new Date().toISOString(),
  mode: fullMode ? "full" : "incremental",
  agent: {
    totalLogEntries: allEntries.length,
    newEntries: newEntries.length,
    lastActivity: allEntries.length > 0 ? allEntries[allEntries.length - 1].timestamp : null,
  },
  stats,
  artifacts,
  issues: dedupedIssues,
  phases: phases.length > 0 ? phases : undefined,
};

// Update state
state.lastLogLine = allEntries.length;
state.lastAnalysis = new Date().toISOString();
state.issueCount = dedupedIssues.length;
saveState(state);

// Output
if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  // Human-readable output
  const status = dedupedIssues.some(i => i.severity === "problem") ? "🔴"
    : dedupedIssues.some(i => i.severity === "warning") ? "🟡" : "🟢";

  console.log(`\n${status} Sisyphus [${report.project}] | ${report.mode} | ${stats.totalTimeSec}s | ${stats.totalCalls} tool calls`);
  console.log(`  Last activity: ${report.agent.lastActivity || "none"}`);
  console.log(`  Papers: ${artifacts.papers.validPdfs} valid / ${artifacts.papers.total} total | Literature: ${artifacts.literature.lines} lines (${artifacts.literature.citedDois} DOIs, ${artifacts.literature.citedArxiv} arXiv)`);
  console.log(`  Report: ${artifacts.report.texLines} lines | PDF: ${artifacts.report.pdfExists ? (artifacts.report.pdfSize / 1024).toFixed(0) + "KB" : "none"} | Figures: ${artifacts.report.figures.length}`);
  console.log(`  Experiments: ${artifacts.experiments.lines} lines`);
  console.log(`  Tool calls: ${Object.entries(stats.byTool).map(([k, v]) => `${k}:${v}`).join(", ")}`);
  console.log(`  Failures: ${stats.failures} (${stats.failureRate})`);

  if (dedupedIssues.length === 0) {
    console.log(`  Issues: none`);
  } else {
    console.log(`  Issues:`);
    for (const issue of dedupedIssues) {
      console.log(`    ${issue.severity}: [${issue.detector}] ${issue.message}`);
    }
  }

  if (phases.length > 0) {
    console.log(`  Phases:`);
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      console.log(`    ${i + 1}. ${p.phase} (${p.durationSec}s, ${p.toolCalls} calls)`);
    }
  }

  console.log();
}
