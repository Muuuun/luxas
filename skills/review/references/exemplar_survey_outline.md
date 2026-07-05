# Exemplar survey outline — annotated gold standard

This is a WORKED EXAMPLE of what `notes/report_outline.md` should look like for
a survey, with WHY-annotations (the `⟨— …⟩` lines; do not copy those into your
outline). It exists because the measured evidence (interpretation-fidelity
study, n=360) says models reproduce pre-chewed structure nearly perfectly and
fail when manufacturing it in a long context: imitate this shape, don't
re-derive it. The example topic is deliberately from a different field so you
cannot copy content, only structure.

```markdown
type: survey
# 载流子倍增材料能否超越单结极限：一个效率-稳定性权衡的地图

⟨— The TITLE is the survey's thesis as a question or claim, never "X 综述".⟩

## §1 引言：为什么 2019 年后这个领域重新分裂成两条路线
**Thesis:** 单结极限的两条突破路线（倍增 vs 级联）在 2019 年的效率交叉点后
不再是替代关系，而是被稳定性约束分配到不同应用区间。
**Figure 1:** 路线分裂示意图 — 两条技术族的效率-年份轨迹交叉于 2019，
之后按稳定性着色分叉。锚定 §2 的分类学。
⟨— A survey whose contribution is a TAXONOMY must name its Figure-1 schematic
   IN THE OUTLINE and say which section it anchors. The intro carries the
   field's tension (why-now), not the report's table of contents.⟩

## §2 六种倍增机制其实是两种：声子瓶颈的有无划分了所有设计
**Thesis:** 表面上并列的六种机制按"是否绕过声子瓶颈"坍缩为两族，
族内差异是工程参数，族间差异是物理。
**Fold in:** PaperA (机制1), PaperB (机制2), … ；**Synthesis move:** 二分树图
⟨— The title states what the classification REVEALS, not "机制分类".
   CRITICAL: section order follows the ARGUMENT (tension → map → frontier →
   gaps), never the order in which experiments/E_N ran. If a reader can
   reconstruct your experiment DAG from the section sequence, the outline
   has failed and will be flagged by PI review.⟩

## §3 效率排行的悖论：报告值最高的机制在寿命指标上全部垫底
**Thesis:** 用统一条件重排 31 篇文献的数字后，效率-稳定性呈严格的
Pareto 前沿，没有材料同时占优 — 这是本综述的核心定量发现。
**Hero figure:** Pareto 前沿散点图（效率 vs 寿命，按机制族着色）。
⟨— The HERO figure carries the survey's one quantitative takeaway and is
   named in the outline. Comparison conditions (temperature, spectrum,
   aging protocol) are stated IN the section — mixing regimes silently is
   the classic survey sin.⟩

## §4 开放问题：三个没人测过的交叉点
**Thesis:** 前沿上的三个空白各自对应一个可执行的实验，其中两个
受当前制备工艺限制，一个纯粹是没人做。
⟨— Gaps are stated as executable questions, not "future work is needed".⟩

## §5 方法与范围声明（\section*，不编号，参考文献之前）
⟨— ALL pipeline confession lives HERE and only here: corpus boundary
   (N papers, sources), classification method + confidence, search-modality
   degradation, [unverified]-class caveats. Body prose never narrates the
   pipeline; this appendix satisfies the disclosure gate.⟩
```

Checklist before writing prose (each maps to a gate or PI check):
- [ ] First line `type: survey` (finish-gate reads this)
- [ ] Every section title is a claim a reader could disagree with
- [ ] Figure 1 (schematic) and hero figure named, with anchor sections
- [ ] Section order = argument order, provably ≠ experiment order
- [ ] One 方法与范围声明 appendix; zero pipeline vocabulary in body
