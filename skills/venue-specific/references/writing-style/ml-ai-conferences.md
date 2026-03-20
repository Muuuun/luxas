# ML/AI Conference Writing Style

Applies to: **NeurIPS, ICML, ICLR, AAAI, COLM, ACL**

Load this when the target venue is any ML/AI conference.

---

## Abstract Formula (Sebastian Farquhar, DeepMind)

Five sentences:
1. **What you achieved**: "We introduce...", "We prove...", "We demonstrate..."
2. **Why this is hard and important**
3. **How you do it** (with specialist keywords for discoverability)
4. **What evidence you have**
5. **Your most remarkable number/result**

**Delete generic openings** that can prepend to any ML paper:
- ❌ "Large language models have achieved remarkable success..."
- ❌ "Deep learning has revolutionized..."
- ✅ Start with your specific contribution instead.

---

## Introduction Structure

**1–1.5 pages maximum** (two-column). Methods should start by page 2–3.

### Template
1. **Opening hook** (2–3 sentences) — State problem and why it matters NOW
2. **Background/Challenge** (1 paragraph) — What makes it hard? Why is prior work insufficient?
3. **Your approach** (1 paragraph) — What do you do differently? Key insight?
4. **Contribution bullets** (2–4 items) — Specific and falsifiable
5. **Results preview** (2–3 sentences) — Most impressive numbers
6. Paper organization (optional, 1–2 sentences)

### Contribution Bullets: Good vs Bad
- ✅ "We prove X converges in O(n log n) time under assumption Y"
- ✅ "We introduce Z, a 3-layer architecture reducing memory by 40%"
- ✅ "We demonstrate A outperforms B by 15% on benchmark C"
- ❌ "We study the problem of X" (not a contribution)
- ❌ "We provide extensive experiments" (too vague)
- ❌ "We make several contributions to the field" (says nothing)

---

## Introduction Deep Structure (Peng Sida)

### Backward reasoning (think first):
1. What technical problem do we solve, and why no well-established solution?
2. What are the contributions of our pipeline?
3. What benefits/insights do contributions bring?
4. How to use prior methods to lead readers to our solved challenge?

### Forward writing (write in this order):
1. Introduce the task
2. Use prior methods to lead to the technical challenge
3. Present contributions to solve the challenge
4. Explain technical advantages and new insight

### Critical Warning
**Do NOT present a naive baseline then describe improvement over it.** This makes work look incremental even if it isn't. Instead: describe the challenge → present your solution.

### Four Introduction Openings

**Version 1** (niche task): Define task → applications → challenge
**Version 2** (familiar task): Applications → challenge directly
**Version 3** (general→specific): General task → narrow to specific setting
**Version 4** (challenge-first): Applications + expose challenge via prior methods → our solution

---

## Method Writing (Peng Sida's 3-Element Model)

Every method module has three elements:

| Element | Question | Writing |
|---------|----------|---------|
| **Module Design** | How does it run? | Input → step 1 → step 2 → output |
| **Motivation** | Why is it needed? | "A remaining challenge is..." |
| **Technical Advantage** | Why is it better? | Compare to alternatives |

### Writing Order
1. Draw pipeline figure sketch
2. Map subsections from sketch
3. Plan each subsection: motivation → design → advantages
4. **Write design first** (concrete backbone)
5. **Add motivation and advantages afterward**

### Method Overview Subsection
1. 1–2 sentences for task setting
2. 1–2 sentences for core contribution
3. Point to pipeline figure
4. Map: "Section 3.1 covers X; Section 3.2 covers Y"

---

## Experiment Writing

### Three Core Questions
1. **Is the method better than strong baselines?** → Comparison experiments
2. **Which modules/design choices make the gain?** → Ablation studies
3. **How far does the method generalize?** → Stress-test scenarios

### Claim-Evidence Alignment
```
Contribution 1 → Validation Experiment 1
Contribution 2 → Validation Experiment 2
Module 1 → Ablation Study 1
Module 2 → Ablation Study 2
```

### Table Rules
- Caption above table; `booktabs` style (no vertical lines)
- Label metric direction: `PSNR ↑`, `LPIPS ↓`
- Consistent decimal precision within each column
- Bold best, underline second-best
- One table = one message

---

## Reviewer Criteria (All ML Venues)

| Dimension | Weight | What Reviewers Ask |
|-----------|--------|-------------------|
| **Quality** | High | Claims supported? Baselines fair? Error bars? |
| **Clarity** | High | Reproducible? Notation consistent? Self-contained? |
| **Significance** | Medium | Impactful? Others will build on it? Important problem? |
| **Originality** | Medium | New insights? Non-trivial? Different from prior work? |

### NeurIPS 1–6 Scale
| Score | Label | Description |
|-------|-------|-------------|
| 6 | Strong Accept | Groundbreaking, top 2–3% |
| 5 | Accept | Technically solid, high impact |
| 4 | Borderline Accept | Solid but limited evaluation |
| 3 | Borderline Reject | Weaknesses outweigh strengths |
| 2 | Reject | Technical flaws or weak evaluation |
| 1 | Strong Reject | Known results or ethics concerns |

### What Moves 3→4 (Borderline → Accept)
- Address obvious weakness proactively (limitations section)
- Add one more strong baseline or ablation
- Improve clarity of contribution statement
- Add reproducibility details (code, hyperparameters)

### Common Reviewer Concerns & Pre-emption

| Concern | Pre-empt |
|---------|----------|
| "Baselines too weak" | Use SOTA baselines, cite recent work |
| "Missing ablations" | Systematic ablation for each module |
| "No error bars" | Report std dev, multiple seeds |
| "Incremental" | Clearly articulate what's new vs prior |
| "Hard to follow" | Clear structure, signposting, notation table |
| "Limited impact" | Discuss broader implications |

---

## Rebuttal Strategy

### Dennett's Method
1. **Acknowledge**: Restate the concern fairly
2. **Agree**: Find points of agreement
3. **Learn**: Show what you learned
4. **Respond**: Address disagreements with evidence

### Template
```
We thank Reviewer [X] for thoughtful feedback.

**[Concern 1: Brief summary]**
We agree that [acknowledgment]. To address this:
- [Evidence: "Table X shows..." / "We added Section Y..."]

**Summary of Changes:**
- [Bullet list of modifications]
```

### Do / Don't
- ✅ Provide concrete evidence (new experiments, tables)
- ✅ Acknowledge valid criticisms
- ❌ Argue that the reviewer is wrong
- ❌ Promise future work instead of showing results
- ❌ Ignore a concern (address ALL points)

---

## Self-Review Checklist (Before Submission)

### Contribution
- [ ] Novel and non-obvious?
- [ ] Meaningful failure case being solved?
- [ ] At least one clear novelty type (task/pipeline/module/insight)?

### Writing
- [ ] Reproducible from paper alone?
- [ ] Each module's motivation explicit?
- [ ] Terms consistent across all sections?

### Experiments
- [ ] Improvements meaningful, not marginal?
- [ ] Gains consistent across datasets/settings?
- [ ] Failure cases reported honestly?

### Evaluation
- [ ] Ablations for all key design choices?
- [ ] All strong/recent baselines under fair settings?
- [ ] Standard metrics for the task?

### Method Soundness
- [ ] Setting realistic for practical use?
- [ ] No hidden technical defects?
- [ ] Benefits outweigh added complexity?
