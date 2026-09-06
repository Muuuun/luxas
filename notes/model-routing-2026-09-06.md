# brain 的模型选型 — 实测 + trace 重定价（2026-09-06）

结论先写：**brain 从 `deepseek-v4-pro` 改到 `gpt-6-astra`，其余生产端不动。**
落地在 `src/agents/spawn.ts`（MODEL_MAP 条目 + applyProfile 的 brain 分支）、`src/index.ts`
（`--profile dual` 设 `LUXAS_BRAIN_MODEL`）、`src/agent.ts`（brain 把自己的 agentName 传给
resolveModel）、`src/model-check.ts`（补 openai catalog，否则 preflight 对 brain 所依赖的
provider 是瞎的）。gate：`scripts/smoke_dual_profile.mts` §3。

总花费 $5.95。

## 1. 测什么

brain 最难的一次生成：把 `RESEARCH.md` 变成完整 pipeline 设计——frame（问题语法分类、
deliverable object、headline quantity ids、premises）+ 实验链（每个实验的 Question /
Approach / Leg A / Leg B / Discriminator / Falsifier / Stop-kill / Figure candidate）+ E1 的
tool 分解（输入签名 + 输出语义）+ 3 个本问题特有的 trap。

system prompt 用 `brain.md` 的 `framing_phase` / `decomposition` / `claim_status_dispatch`
原文摘录。user turn 只有 `RESEARCH.md`，没有文献——就是 brain 第一轮真实看到的东西。

任务用 `benchmarks/` 里的 bench-01（数值 + 独立标定）、bench-02（ab-initio + 已知的
analytic/TDSE 分歧）、bench-03（文献裁决，无新计算）。三个都有生产 run 留下的 `ORACLE.md`。

选手：`gpt-6-astra`、`glm-5.3`、`deepseek-v4-pro`、`claude-opus-5`、`claude-fable-5-1`。

## 2. 三条打分通道

| 通道 | 做法 | 结果 |
|---|---|---|
| 契约合规 | 确定性正则，12 分 | **不区分**：五个模型 11.3–12.0。前沿模型已经不会写坏结构了 |
| 盲评 rubric | 3 个评委 × 3 任务，候选匿名 A–E，每个评委独立打乱标签顺序 | opus-5 4.48 > fable 4.27 > gpt-6 4.21 > glm 4.16 >> deepseek 2.94 |
| oracle 命中 | 评委手里拿 `ORACLE.md`，只问"这个设计会不会抓住那个具体失败" | glm 0.89 > fable 0.83 > opus 0.78 > gpt-6 0.72 > deepseek 0.67 |

**评委的同门偏袒是真的，而且很大。** claude-sonnet-5 三个任务全把 claude-opus-5 排第一；
gpt-5.6-terra 三个任务全把 gpt-6-astra 排第一。修法是把每个评委自己家族的候选删掉再按
归一化名次（0 最好、1 最差）打分。**只有两个利益相关评委时这个修正本身是不稳的**——当时
glm-5.3 排第一、opus-5 掉到第三。加了 `kimi-k3`（Moonshot 没有选手，所有判断都是跨家族）
之后翻转：opus-5 0.264 < fable 0.333 < glm 0.407 < gpt-6 0.458 << deepseek 0.889。

**教训：评委席里必须有一个没有选手的厂商。** 否则名次是厂商投票，不是质量。

## 3. deepseek-v4-pro 输在哪（这是改路由的理由）

九次排名里八次垫底，三个通道全部最后。失败是结构性的，不是文风：

- bench-01：把 Q 值提取、势垒构造、WKB 积分、系统学对照、半衰期换算**压成一个实验**，
  其他四个模型都建了 3–4 个。
- bench-02（kimi-k3 原话）："Adopts r₀(θ) from |C₆(θ)|/r₀⁶ = ħΩ, so V ≡ ħΩ at every θ and
  p₂(θ) is flat by construction — it states the central trap exactly backwards, and its own E2
  falsifier must spuriously fire." 参数化把要测的信号抹平了，kill criteria 会对着自己制造的
  假象触发。
- 反复把 **同一个 Hamiltonian 的两种解法**（符号 vs 数值）写成 Leg A / Leg B。这正是
  claims-first 架构存在的理由所要抓的假独立。

## 4. 用真 trace 重定价（这才是决策依据）

benchmark 只测一次生成，一个 run 是 2,543–3,107 次。拿 `ba-atom-qc-feasibility` 的真实
token profile（按 agent 归因自 `.agent/conversations/*.jsonl`，brain 是残差——usage.log 没有
agent 字段），按各家现价 + 各家**真实 cache 行为** + 实测 tokenizer 系数重算：

| 设计 | $/run | vs dual | brain 占比 |
|---|---|---|---|
| A 全 DeepSeek（改之前的默认） | 32.31 | 1.00× | 22% |
| C brain → glm-5.3 | 39.13 | 1.21× | 36% |
| **B brain → gpt-6-astra（已落地）** | **50.56** | **1.57×** | 50% |
| G brain → gpt-6-astra，reviewer → opus-5 | 92.10 | 2.85× | 28% |
| D brain → claude-opus-5 | 239.99 | 7.43× | 90% |
| I 全部 → claude-opus-5 | 975.53 | 30.2× | 22% |

### 4.1 为什么 Anthropic 这么贵——三个乘数叠加，cache 是最大那个

1. **tokenizer**：同一段文字 Anthropic 计 **1.474×** 的 token（15 个 bench prompt 上实测，
   4,515–4,549 vs 3,062–3,081）。
2. **单价**：opus-5 input 是 deepseek 的 3.8×。
3. **cache 写入**：DeepSeek **cache 写入不计费**，读 $0.044/M，命中率 91–94%。Anthropic
   写 cache 要 **$6.25/M**（1.25× input）。语料里唯一的 Anthropic-profile run
   `qldpc-neutral-atom`（$155.29）**写了 30.3 M cache token，只读回 21.1 M**——写多于读，
   **$133/$155（86%）花在 cache 写入上**，sonnet 那档复用比只有 0.15。

brain 是全系统 cache 最重的 agent（34.8 M prompt token，91% 命中）——正好是 DeepSeek 上最
便宜、Anthropic 上最贵的那种 profile。所以一个 agent 能吃掉 90% 的 run。

乐观上界（每次 miss 只写一次 cache，不用实测的写读比）D 仍要 $92.30。

### 4.2 gpt-6-astra 的价格是估的，但结论不依赖它

OpenAI 没有 API 可读的报价，pi-ai catalog 也没有条目。分析用 $3/$18；代码里按 DeepSeek
条目的规矩**往高了钉 $5/$30**（cost cap 宁可早咬），此时 run 是 $67；最悲观 $5/$30 +
cacheRead $1.0 是 $82.80。对手 opus-5 是 $239.99。**三种价格假设下结论都一样。**

## 5. 为什么是 gpt-6-astra 而不是更省的 glm-5.3

按"买到多少可得改进"算（deepseek = 0%，各通道最优 = 100%）：

| brain 模型 | rubric | oracle | 修正名次 | 均值 | 占满额成本的 | brain 延迟 |
|---|---|---|---|---|---|---|
| glm-5.3 | 79% | 100% | 77% | **85%** | **3.3%** | +16% |
| gpt-6-astra | 82% | 23% | 69% | 58% | 8.8% | **−63%** |
| claude-opus-5 | 100% | 50% | 100% | 83% | 100% | −36% |

单看性价比 glm-5.3 赢，而且**它买到的改进比 opus-5 自己还多**（85% vs 83%，因为 opus-5 在
oracle 通道只是中游）。选 gpt-6-astra 的两条理由：

1. **墙钟**。brain 的 340 次调用是**串行**的，直接进 wall clock。参考 run 已经跑了 13.2 h，
   默认时间上限是 8 h。gpt-6-astra 每次调用 81 s vs deepseek 217 s vs glm 252 s。
2. **零编造**。所有评委的 fabrication flag 里 gpt-6-astra **一次都没有**；glm-5.3 有三次，
   其中一次是把 C₆ 的原子单位换算写错 **9 个数量级**，并且是写在 Frame 里当既定事实。
   对一个"给下游所有实验定前提"的 agent，这条比 rubric 分数重要。

预算紧时 `LUXAS_BRAIN_MODEL=glm-5.3` 是一行回滚，$39.13/run，仍在 $50 默认上限内。

## 6. 顺带测到的

- **claude-opus-5 / fable-5.1 在这三个 prompt 上一次都没拒绝**（全部 `end_turn`）。已记录的
  `refusal / cyber` 是**审稿形状**的 prompt 触发的（"decide whether the claim should ship"），
  不是中性原子物理内容本身。这缩小了 `spawn.ts` 里记的封锁范围，但没解除它。
- **glm-5.3-flash 不能当结构化评委**：12k 下烧掉 11,979 个 reasoning token 没吐 JSON，32k 下
  吐坏 JSON，再试连接超时。画图审计的岗位不受影响。
- **kimi-k3 必须用 `stream: true`**：非流式挂了两次，看起来和死掉的 endpoint 一模一样。它会
  先吐 ~25,000 字符的 reasoning，**第一个 content token 在 152 s**。流式 + 48k 上限下三个任务
  全部干净返回，$0.21。任何路由到 Moonshot 的 agent 都要走流式，否则失败是不可见的空回复。
- **各家 output 预算不通用**：glm-5.3 写第一个字前烧 15.6–18.5k reasoning token，
  deepseek-v4-pro 8–13k，两者在 16k 上限下都被静默截断，要 40k。Claude 5 档在不传
  `thinking` 参数时**默认就吐 thinking block**，opus-5 在 8k 上限里只写出 584 个词。
  按一家调好的上限会把另一家从计划中间切断，`stop_reason` 是唯一信号。
- **历史 trace 是按旧价计费的**：ba run 拟合出 input $1.667/M、output $3.333/M、
  cacheRead $0.139/M，不是现在钉的 1.32/3.96/0.044。做任何 trace 比较前先从 trace 里反解
  有效费率，或者像这里一样全部按现价重算。

## 7. 复测方法

harness 是一次性的（会话 scratchpad），但设计可复用：三条通道（确定性契约检查 / 每评委打乱
标签的盲评 / oracle 锚定的 trap 命中），**评委席必须含一个无选手厂商**，然后拿真 trace 重
定价而不是比 per-call 单价。改完路由跑 `npx tsx scripts/smoke_dual_profile.mts` 和
`luxas models`。

样本量诚实交代：3 任务 × 1 次生成 × 3 评委，oracle 通道只有 1 个评委。**"deepseek 垫底"和
"契约通道已饱和"是结论**；opus-5 第一、fable 第二算比较稳；glm-5.3 与 gpt-6-astra 之间的
排序是软的——加评委那次就翻过一回。
