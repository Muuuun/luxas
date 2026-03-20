# Systems Conference Writing Style

Applies to: **OSDI, NSDI, ASPLOS, SOSP**

Load this when the target venue is a systems conference.

---

## Key Differences from ML Venues

| Aspect | ML/AI Venues | Systems Venues |
|--------|-------------|---------------|
| **Page limit** | 7–9 pages | 12 pages |
| **Evaluation** | Benchmarks, ablations, metrics | End-to-end system performance, real workloads |
| **Implementation** | Code often optional | **Working system expected** |
| **Novelty** | New methods/insights | New system designs/approaches |
| **Reproducibility** | Checklist-based | Artifact evaluation (optional) |

---

## Core Review Criteria

| Criterion | What Reviewers Look For |
|-----------|------------------------|
| **Novelty** | New system design, not incremental improvement |
| **Significance** | Solves important practical problem |
| **System Design** | Sound architecture, clear design decisions |
| **Implementation** | Working prototype, not just simulation |
| **Evaluation** | Real workloads, end-to-end performance |
| **Clarity** | Clear writing, reproducible |

---

## Venue-Specific Review Notes

### OSDI 2026
- No author response period
- Conditional accept replaces revise-and-resubmit
- Target acceptance ≥20%
- **Reviewers encouraged to down-rank padded papers** (be concise even with 12 pages)
- **Operational Systems Track**: real-world deployment at scale; novel research ideas NOT required

### NSDI 2027
- **Prescreening on Introduction only** (3 criteria: scope, accessibility, track alignment)
- One-shot revision: rejected papers may receive issues list → resubmit at next deadline → same reviewers
- Three tracks: Research (novel + evidence), Frontiers (bold non-incremental, evaluation relaxed), Operational (deployment lessons)

### ASPLOS 2027
- **Rapid review: reviewers read ONLY first 2 pages**
- First 2 pages must be self-contained
- Must advance Architecture, PL, or OS research
- Major Revision decision available

### SOSP 2026
- Encourages groundbreaking work in significant new directions
- Author response limited to: correcting factual errors + addressing questions (NO new experiments, <500 words)
- Optional artifact evaluation

---

## Common Systems-Specific Concerns

| Concern | How to Pre-empt |
|---------|-----------------|
| "Just an ML paper, not systems" | Emphasize system design, architecture decisions, deployment challenges |
| "Only microbenchmarks" | Include end-to-end evaluation with real workloads |
| "No working prototype" | Build and evaluate real system, not just simulate |
| "Not relevant to community" | Frame in systems terms, cite systems papers |
| "ASPLOS: Not advancing arch/PL/OS" | Explicitly state how work advances core disciplines |
| "Padded paper" | Be concise; 12 pages doesn't mean fill 12 pages |

---

## Writing Advice for Systems Papers

### Introduction (especially for NSDI prescreening)
- First 2 pages must stand alone: problem → approach → key result
- Lead with the system challenge, not the ML technique
- Emphasize **why existing systems don't solve this**
- Show you built something real, not a theoretical framework

### Evaluation Section
- End-to-end performance on real workloads (not just synthetic benchmarks)
- Compare against deployed systems or strong baselines
- Report latency, throughput, resource usage — not just accuracy
- Include failure mode analysis and scaling behavior
- Document hardware, software stack, deployment conditions

### Related Work
- Frame around system lineage (prior system designs solving similar problems)
- Don't over-cite ML papers in a systems venue
- Show awareness of deployed industry systems

### Author Response
- Systems venues often have strict word limits (500 words)
- Focus on correcting factual errors only
- No new experiments or data
