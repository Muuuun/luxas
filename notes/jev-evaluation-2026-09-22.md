# jev 不进架构，但它量出了 `sameRoute()` 是死的（2026-09-22）

结论先写：**`typesafe-ai/jev` 通过 Vercel AI Gateway 完全可用，但不采纳**——它在真语料上
分不开 wiring 和独立（AUC 0.670）。同一批测量里捞出的真东西是另一件事：
**`claims-review.ts` 的 `sameRoute()` 在 64 对真实 cross-validation 上开火 0 次**，
wiring 检测 100% 靠数值 1e-6 veto 撑着。修法见 §5。

总花费 $0.0000004（约 100 次 jev 调用）。

## 1. jev 是什么，怎么调

`typesafe-ai/jev`，Vercel AI Gateway 目录里 `"type": "evaluation"` 的模型。**不是语言模型**：
`chat/completions` 和 `/v1/responses` 都返回 `ModelTypeMismatchError`。真正的端点是
`POST /v1/evaluate`，纯 REST，不需要 AI SDK。

```jsonc
{ "model": "typesafe-ai/jev",
  "state": { /* 任意 record，被评的“共享状态” */ },
  "questions": {                       // record，不是 array；key 即返回 key
    "q1": { "type": "boolean", "criteria": { "true": "…", "false": "…" } },
    "q2": { "type": "choice",  "criteria": { "optA": "…", "optB": "…" } },
    "q3": { "type": "score",   "criteria": [ "最低档", "…", "最高档" ] }   // array，≥2
  } }
```

boolean 回 `probability`；choice 回 `choice` + 各项 `probabilities` + `confidence`；
score 回档位加权 `score` + 分布。也接受 `instructions` 字符串代替 `criteria`。
`max_tokens: 0`、catalog 里没有 `supported_parameters` → **没有 tool calling，接不了任何
agent 槽位**。$0.042/M 入、$0 出，~300 ms，实测 19.8k input token 正常（声明 32k）。

## 2. 它的能力边界（实测）

- **确定性**：同输入 ×6 → `0.230 0.220 0.220 0.220 0.220 0.220`，spread **0.010**。可进 gate。
- **零位置偏倚**：同两候选换顺序，P(A)=1.00 / 0.00，positional lean **+0pp**。比
  `model-routing-2026-09-06` 里那两个三任务全排自家第一的利益相关评委干净。
- **标定偏保守**：应为真的一侧只到 0.42–0.85。**别用绝对阈值卡 0.5**，用 Δ 或排序。
- **读得懂 state**：6 对"只差被测事实、先验故意指向错误方向"的状态，6/6 判对
  （Δ +0.30…+0.81）。

## 3. 为什么仍然不采纳 —— 我先把自己钓上来了

原假设：用它补 `sameRoute()` 的语义盲区，检测假独立（claims-first 的第一号猎物）。

**我手写的 8 对 route → jev 8/8，`sameRoute()` 4/8。** 看起来赢定了。
然后按事先立的 falsifier 去真语料复测，翻车：

```
标签来自数字（jev 只看文本，从未见过任何数值）
  bit-wiring   rel<=1e-6 : n= 5  mean P=0.58  range 0.33–0.84
  independent  rel > 0.1 : n=20  mean P=0.67  range 0.44–0.83
  middle band            : n=39  mean P=0.62  range 0.26–0.78
  AUC = 0.670      flag P<0.4 只抓到 1/5
```

那 8/8 是**我照着自己的假设编的例子**——正是 `tool_impl` / `tool_review` 分家要防的
self-circular，我对自己犯了一次。

失败的原因在数据里是明写的：

```
P=0.61  rel=1.8e-16  analytic sixth-root closed form ⟂ direct geometric 3D density ratio
```

这两句读起来是两条完全不同的推导，数值却一致到 **1e-16**。文本里没有这个信息，任何读文本的
东西——模型或人——都判不出来。**两个具名方法是否共享物理，是 state 不携带的领域知识。**

由此得到 jev 的一般判据：**答案在 state 里时它能答；答案需要 state 不携带的领域知识时它不能。**
这一条同时否掉了 wiring 检测和 claim grading（后者本来就该留在确定性纯函数里）。

标签噪声披露：负类只有 n=5，其中 `Casimir formula ⟂ literature value`（rel 8.9e-8）很可能
是 A 被拟合过的**真**一致而非 wiring。所以这个检验**既欠功效、又没显出分离**——两种情况
都不支持采纳。

## 4. 真正捞到的东西：`sameRoute()` 从来没开过火

同一批 64 对（droplet 上 212 个 `results.json`，5 个项目，`computed.cross_validation`
带双 method 字符串 + 双数值的全部）：

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

## 5. 修法：不是放宽阈值，是读自白

相似度救不了。bit-wiring 那几对的 token 重合度本来就低
（"analytic sixth-root closed form" vs "direct geometric 3D density ratio" 近乎零重合），
所以 Jaccard / containment 调阈值只是换个方式拟合 n=25：

```
jaccard      AUC 0.760      containment  AUC 0.820      （都比 jev 的 0.670 高，但都是 n=25 上调出来的）
```

**不采用任何调出来的阈值**——那就是 §3 的错误再犯一次。

采用的是一条不依赖样本量的规则：**一条 route 如果在自己的描述里承认它是在重读 / 重加 /
内部于另一条腿，那它按自己的说法就不是第二条腿。** 这是读自白，不是统计推断。

实测（同 64 对）：命中 4 条，**4/4 都是真 wiring，20 条独立里 0 条误伤**，
而且其中 **2 条落在 1e-6 之上的中间带——今天没有任何机制能抓到它们**：

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

## 6. jev 的去向

不进架构。它唯一被实测证实的强项（state 里已载明事实的审计：测试到底跑没跑、edit 到底落盘
没有、caption 承诺的曲线图里画没画，实测 +0.50…+0.67）对应的消费端是 `figure_auditor` /
`contradiction_auditor`，六个 run 加起来 $13.4 / $646 = 2%，而 figure 循环已被 v4 的 2 轮
上限封住。为 2% 的奖品引入一个新 provider 依赖和新失败模式，不划算。

留一条以后可能用得上的：**下一次模型 A/B 时，jev 可以当第四条打分通道**——零位置偏倚 +
确定性 + 厂商中立（typesafe-ai 在 Luxas 任何槽位都没有参赛模型），正好满足
`model-routing-2026-09-06` 定下的"评委席必须含一个没有选手的厂商"。但它只吐概率不吐理由，
永远只能是附加通道，不能当主评委——那次 A/B 最值钱的产出是"glm 把 C₆ 原子单位换算错了
9 个数量级"这类具体指认。

## 7. 复现

```
scripts/route_pairs.mts <projects-root>     # 抽 64 对（离线）
fixtures/route-confession/pairs.json        # 抽出来的真语料，gate 的输入
npx tsx scripts/smoke_route_confession.mts
```
jev 的探针脚本没有入库（一次性，且需要 `AI_GATEWAY_API_KEY`）：schema 逼近、6 对对抗状态、
确定性 ×6、顺序偏倚、64 对真语料，全部记录在本文件 §1–§4 的数字里。
