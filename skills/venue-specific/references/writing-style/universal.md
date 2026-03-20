# Universal Writing Principles

Applies to ALL venues and disciplines. Load this alongside any venue-specific file.

---

## The Narrative Principle

> "A paper is a short, rigorous, evidence-based technical story with a takeaway readers care about." — Neel Nanda (DeepMind)

**Three pillars** (must be crystal clear by end of introduction):

| Pillar | Question | Failure Mode |
|--------|----------|-------------|
| **The What** | 1–3 specific novel claims | "We study X" (not a contribution) |
| **The Why** | Rigorous evidence for claims | Weak baselines, no ablations |
| **The So What** | Why readers should care | No connection to recognized problems |

**If you cannot state your contribution in one sentence, you don't yet have a paper.** — Andrej Karpathy

---

## Time Allocation

Spend approximately **equal time** on each of:
1. The abstract
2. The introduction
3. The figures
4. Everything else combined

**Why?** Reviewer reading order: title → abstract → introduction → figures → maybe the rest.

| Section | % Reviewers Who Read | Time Spent | Implication |
|---------|---------------------|------------|-------------|
| Abstract | 100% | 2–3 min | Must be perfect |
| Introduction | 90%+ (skimmed) | 3–5 min | Front-load contribution |
| Figures/Tables | Before methods | 2–3 min | Figure 1 is critical |
| Methods | Only if interested | 5–10 min | Don't bury the lede |
| Appendix | <30% | As needed | Supplementary only |

---

## Gopen-Swan 7 Principles of Reader Expectations

From "The Science of Scientific Writing" — based on cognitive science.

### 1. Subject-Verb Proximity
Keep grammatical subject and verb close together.
- ❌ "The model, which was trained on 100M tokens and fine-tuned with LoRA rank 16, achieves SOTA"
- ✅ "The model achieves SOTA after training on 100M tokens and fine-tuning with LoRA (rank 16)"

### 2. Stress Position
Place emphasis at sentence ends — the position readers naturally stress.
- ❌ "Accuracy improves by 15% when using attention"
- ✅ "When using attention, accuracy improves by **15%**"

### 3. Topic Position
Put context first, "whose story" element first.
- ❌ "A novel attention mechanism that computes alignment scores is introduced"
- ✅ "To address the alignment problem, we introduce a novel attention mechanism"

### 4. Old Before New
Familiar information in topic position; new in stress position.
- ❌ "Sparse attention was introduced by Child et al. The quadratic complexity of standard attention motivates this work."
- ✅ "Standard attention has quadratic complexity. To address this, Child et al. introduced sparse attention."

### 5. One Unit, One Function
Each sentence, paragraph, section serves a single function. Two points → two units.

### 6. Action in Verb
Express action in verbs, not nominalizations.
- ❌ "We performed an analysis of the results"
- ✅ "We analyzed the results"

### 7. Context Before New
Provide context before asking reader to consider anything new.
- ❌ "Equation 3 shows that convergence is guaranteed when..."
- ✅ "For convergence to be guaranteed, the learning rate must satisfy Equation 3"

---

## Micro-Level Clarity (Ethan Perez, Anthropic)

- **Minimize pronouns**: ❌ "This shows..." → ✅ "This result shows..."
- **Verbs early**: Place verbs near sentence start
- **Unfold possessives**: ❌ "X's Y" → ✅ "The Y of X" (when awkward)
- **Delete filler words**: actually, a bit, very, really, basically, quite, essentially
- **Active voice**: ❌ "The method was applied" → ✅ "We applied the method"
- **One idea per sentence**: If struggling, split into two

---

## Word Choice & Precision (Zachary Lipton + Jacob Steinhardt)

### Be Specific
| Vague | Specific |
|-------|---------|
| performance | accuracy, latency, throughput |
| improves | increases accuracy by X%, reduces latency by Y |
| large | 1B parameters, 100M tokens |
| significant | statistically significant (p < 0.05), or remove |

### Eliminate Hedging
Drop "may" and "can" unless genuinely uncertain.
- ❌ "This may improve performance"
- ✅ "This improves accuracy by 3.2%"

### Delete Intensifiers
- ❌ "provides *very* tight approximation"
- ✅ "provides tight approximation"

### Vocabulary Signaling
- ❌ "combine," "modify," "expand" (sounds incremental)
- ✅ "develop," "propose," "introduce" (sounds like contribution)

### Consistent Terminology
Same concept = same term. Pick one and stick with it:
- "model" vs "network" vs "architecture" — pick one
- "training" vs "learning" vs "optimization" — pick one

---

## Sentence Length Guide

| Type | Words | Use For |
|------|-------|---------|
| Short | 10–15 | Key findings, transitions |
| Medium | 15–25 | Most content |
| Long | 25–40 | Complex relationships |
| Very Long | >40 | ⚠️ Consider splitting |

---

## Paragraph Architecture

1. **First sentence**: State the point clearly (topic sentence)
2. **Middle sentences**: Support with evidence (3–5 sentences typical)
3. **Last sentence**: Reinforce or transition

Don't bury key information in middle of paragraphs.

---

## Writing Flow Diagnosis

### Reverse Outlining (post-writing tool)
1. Write down thesis statement
2. Write down each topic sentence of each paragraph
3. Write down main evidence/explanation per paragraph
4. Check: every topic sentence clearly related to thesis?
5. Check: all evidence pertains to its paragraph's topic?

If easy to reverse-outline → well-organized paper. If hard → unclear structure.

### Transition Words

| Relationship | Words |
|-------------|-------|
| Addition | furthermore, moreover, additionally |
| Contrast | however, nevertheless, conversely |
| Cause/Effect | therefore, consequently, thus |
| Example | for instance, specifically, in particular |
| Sequence | first, second, subsequently, finally |
| Summary | in conclusion, in short, to summarize |

---

## Citation Integration

### Anti-Stacking Rule
Max **2 clustered citations** without individual discussion per sentence.

❌ FORBIDDEN:
```
Many methods have been proposed [1], [2], [3], [4], [5].
```

✅ REQUIRED:
```
Smith et al. [1] proposed X for scenario A. Building on this,
Jones [2] extended to B, while Wang et al. [3] addressed C.
```

### Every cited work must earn its citation with at least one of:
- A summary of its core contribution (1 clause minimum)
- A comparison with another cited work
- A specific limitation that motivates your work

---

## Reporting Verbs

| Strength | Verbs |
|----------|-------|
| Neutral | states, notes, observes, reports, describes |
| Strong | demonstrates, shows, proves, confirms, establishes |
| Tentative | suggests, implies, indicates, proposes |
| Critical | claims, argues, asserts, alleges, maintains |
