# `sameRoute()` 是死的：wiring 检测改读自白（2026-09-22）

结论先写：**`claims-review.ts` 的 `sameRoute()` 在 64 对真实 cross-validation 上开火 0 次**，
wiring 检测 100% 靠数值 1e-6 veto 撑着。修法是 `routeConfessesDependence()`，见 §2。

来源：这个测量是评估外部评估模型 `typesafe-ai/jev` 时顺带做的。jev 没有进入 Luxas，
2026-09-24 连同评估笔记一起移出本仓库，归档在 `github.com/Muuuun/can-llm-spot-wiring`
（private）：jev 在同一批 64 对上 AUC 0.670，而 opus-4.6 / kimi-k3 只读 route 文本就有
0.87 / 0.88——**route 文本是带信号的，jev 读不出来是它缺领域知识**，不是信息上限。

## 1. `sameRoute()` 从来没开过火

64 对 = droplet 上 212 个 `results.json`，5 个项目，`computed.cross_validation` 带双 method
字符串 + 双数值的全部：

```
sameRoute() 判 wiring : 0 / 64
数值 bit-identical (rel<=1e-6) : 5 / 64   其中 sameRoute() 抓到 0
route 文本里自称 "independent" 的： 10 / 64   其中数值上 bit-identical： 3
```

`sameRoute()` 是 token 集合**完全相等**，而 route 是 producer 自由书写的一句话，
所以它实际等价于"永远说独立"。**production 里每一次 wiring 判定都来自数值 1e-6 veto。**
又一次 §生产者-消费边纪律：`claims-table.ts:548` 和 `:731` 都在调它，看着是活的，贡献为零。

顺带量出一个此前只是怀疑的洞：**wiring 只在两个数字恰好撞上时才被抓到**。
在 1e-6 与 tolerance 之间的 39 对里有多少假独立，此前无人知道，也无从知道。

## 2. 修法：不是放宽阈值，是读自白

词面相似度救不了。bit-wiring 那几对的 token 重合度本来就低
（"analytic sixth-root closed form" vs "direct geometric 3D density ratio" 近乎零重合，
数值一致到 1e-16），所以 Jaccard / containment 调阈值只是换个方式拟合 n=25：

```
jaccard      AUC 0.760      containment  AUC 0.820      （都是 n=25 上调出来的）
```

**不采用任何调出来的阈值。**

采用的是一条不依赖样本量的规则：**一条 route 如果在自己的描述里承认它是在重读 / 重加 /
内部于另一条腿，那它按自己的说法就不是第二条腿。** 这是读自白，不是统计推断。

实测（同 64 对）：命中 4 条，**4/4 都是真 wiring，20 条独立里 0 条误伤**，
而且其中 **2 条落在 1e-6 之上的中间带——此前没有任何机制能抓到它们**：

```
[middle  rel=3.4e-5 ] packing optimizer INTERNAL full-pairwise evaluation
                    ⟂ independent brute-force re-check of the SAME exhibited lattice
[middle  rel=7.8e-6 ] Le Kien SOS (A -> |<d>|^2 -> 6j -> alpha)
                    ⟂ alpha = sum f_n/omega_n^2 with f derived from the SAME A
[wiring  rel=0      ] fom_table resolution of quantity id …
                    ⟂ E4 DECLARED computed.laser_inventory.mot_laser_count READ DIRECTLY from …
[wiring  rel=2.2e-13] E6 packing optimizer INTERNAL full-pairwise check
                    ⟂ independent brute-force recheck of the SAME exhibited lattice
```

落地：`routeConfessesDependence()` in `src/claims-review.ts`，在 `relation()` 里与
`sameRoute()` 并列作为 wiring 的一条腿，并进入 `:731` 的 `routesDiffer`。极性与现状一致
（开火 = 保守 = 丢一个 corroboration credit，不会凭空授予）。
gate：`smoke_route_confession`，fixture 是这 64 对真语料。

**已知风险，写在这里而不是藏起来：**
1. **惩罚诚实。** 老实写 "internal check" 的 producer 被扣分，写 "second method" 的不被扣。
   这是所有文本规则的通病（现有的 `sameRoute()` 同样如此），但要记着：一旦发现 producer
   开始规避这些词，这条规则就失效了，需要改成 provenance（谁产出了这个 artifact），不是措辞。
2. **n=5 负类。** 4/4 精度是在很小的样本上。所以只收录**语义上是自白**的短语，不收录
   任何靠 AUC 调出来的阈值；新增短语必须能指向一个真实语料例子。
3. `same` 这类通用词只在与依赖动词同现时才算数，避免 "the same n=60 state" 这种无害用法。

## 3. 还开着的一条路（未落地）

自白规则抓不到的 3 个 wiring 对上，强 LLM 只读 route 文本仍有 AUC 0.83–0.86
（例：Casimir 公式 ⟂ ⁸⁷Rb 文献分裂，opus 指出 5S₁/₂ 的分裂恰为 2A，按构造一致）。
但数值相差 >10% 的独立对里它们在 P≥0.5 误报 7/20（opus）、11/20（kimi），**不能当 gate**。
合适的位置是 experiment_reviewer 的非阻断提示——reviewer 还能看脚本，上下文比一行 route 多得多。

## 4. 复现

```
scripts/route_pairs.mts <projects-root>     # 抽 64 对（离线）
fixtures/route-confession/pairs.json        # 抽出来的真语料，gate 的输入
npx tsx scripts/smoke_route_confession.mts
```
