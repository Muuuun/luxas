# 两家都自建 harness，并同步收紧 API 契约

截至 2026-10-12，DeepSeek 和 Anthropic 都把 harness 做成了第一方产品，也都在 8–9 月改掉了自建 agent 循环依赖的几条 API 行为；对自己运营 harness 的人，后一件事影响更直接。Anthropic 在半年里把 Claude Code 扩成分层的多代理运行时（后台子代理、由脚本持有循环的 dynamic workflows、fork、云端和自托管执行），并在 2026-04-08 公测了托管的 Managed Agents；DeepSeek 在 8 月发布 MIT 许可的 DeepSeek Harness 开发者预览，API 收敛到 `deepseek-flash` 和 `deepseek-v4-pro` 两个 id，并改成峰谷定价。契约层面，Claude 的 Fable 5.1、Mythos 5.1、Opus 5.5、Sonnet 5.5 对 `tool_choice` 的 `any` 和 `tool` 返回 400，并把 thinking block 绑定到未改动的对话前缀（[API release notes](https://platform.claude.com/docs/en/release-notes/overview)）；DeepSeek 在带 `tools` 的请求里要求回传每一轮的 `reasoning_content`，否则 400，thinking 模式下不支持 `required` 和指定函数的 `tool_choice`（[Thinking Mode guide](https://api-docs.deepseek.com/guides/thinking_mode)；[Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion)）。独立测量里，Claude 模型配 Claude Code 占据仍有区分度的榜单前列（Terminal-Bench 4.0 官方榜上 Opus 5.5 + Claude Code 为 64.8%），DeepSeek 在多数官方榜上没有条目；Artificial Analysis 在 Codex harness 里测得 V4 Pro 0813 的 Coding Agent Index 为 43.1、每任务 $0.24，Claude Code 里的 Opus 5.5 为 66.0、$13.04（[tbench.ai leaderboard](https://www.tbench.ai/leaderboard)；[AA Coding Agents](https://artificialanalysis.ai/agents/coding-agents)）。差距随任务变长而拉大，价差几乎全部来自单价和缓存读取价，缓存命中率在两家都是成本的第一杠杆。最新的一步在扩展层：Claude Code 10 月 1 日推出 Mods（在进程内拦截工具调用、模型请求和界面的插件），DeepSeek Harness 两天后加了一个实验性的 Mods 兼容层，见第四节。有一件事没有定论：`deepseek-v4-pro` 在 9 月 14 日之后由 V4-Pro-0813 还是 V4.1-Flash 服务，DeepSeek 自己的页面互相矛盾，第三节列出两边出处和几分钱就能做完的验证办法。关于证据质量：研究者没有调用任何付费 API，文中没有一个数字是现场实测；Anthropic 的文档和 release notes 是直接读的原文，Anthropic 的博客文章与 DeepSeek 的全部页面经过摘要式抓取工具，引号里的措辞在转载前要对照原页。

## Anthropic 半年发了 166 个 Claude Code 版本，把编排从模型手里移进脚本

Claude Code 从 v2.1.89（2026-04-01）到 v2.1.296（2026-10-09）发了 **166 个版本**，这段时间约 5,650 条 changelog 条目里约 3,230 条以 "Fixed" 开头（[Claude Code CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)；日期取自 [GitHub releases](https://github.com/anthropics/claude-code/releases)）。多代理的默认值是边跑边调出来的：子代理自 07-01 起默认在后台运行；嵌套深度 07-21 从 5 降到 1，三天后又升到 3；07-21 加了 **20 个并发子代理**的上限；07-17 加的"每会话 200 次 spawn"上限在 08-07 被删掉；08-13 起 fork 子代理在交互会话里默认开启，继承完整对话和 prompt cache，在 `claude -p` 和 Agent SDK 里默认关闭（[CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)；[sub-agents 文档](https://code.claude.com/docs/en/sub-agents)）。

最大的结构变化是 05-28 的 dynamic workflows。一个 workflow 是一段 JavaScript，运行时提供 `agent()`、`parallel()`、`pipeline()`，循环、分支和中间结果都留在脚本里，编排模型的上下文只收到最终答案；按研究者的梳理，这是 Claude Code 里唯一一种中间结果不进入编排模型上下文的形式（[workflows 文档](https://code.claude.com/docs/en/workflows)）。运行时为重放做了确定性约束：脚本里调用 `Date.now()`、`Math.random()` 会抛错；重启时已完成的 agent 返回存下的结果，直到第一个 prompt 变了的 agent 为止，它和它之后的全部重跑；输出停滞的 agent 最多重启五次；默认 16 个并发，每次运行最多 1,000 个 agent。08-12 起同前缀的兄弟 agent 会被错开最多 5 秒，让后启动的读到第一个写下的缓存前缀（[CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)）。Anthropic 给出的理由是单个长上下文的三种失败：偷懒（安全审查 50 项只处理 35 项）、验证自己产出时的偏袒、摘要造成的目标漂移。同一篇文章也写明"多数传统编码任务不需要五个审稿人"（[A harness for every task](https://claude.dev/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code/)，经摘要式抓取）。

权限默认值从逐条人工批准换成了分类器。auto mode 在 08-11 成为 Pro/Max/Team 的内置默认，09-28 扩到所有 plan 和 provider，09-29 扩到第三方 provider 或关闭遥测时的 `claude -p` 与 Python Agent SDK。分类器是第二个模型，默认跑在 Sonnet 5 上，只看用户消息、非只读的工具调用和 CLAUDE.md，工具结果被剥掉（[permission-modes 文档](https://code.claude.com/docs/en/permission-modes)）。同期有三处改动给进入上下文的文字标注来源：子代理结果放在标明"子代理输出"的标题下并缩进（09-18），后台任务通知写明没有人类输入发生（07-08），以及 agent 的消息永远不算用户的批准（07-01）（[CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)）。Anthropic 把"来源标注"当作 harness 要在排版上强制的事，没有留给模型自己判断。

对把 `claude -p` 当执行器调用的人，契约有四处在动。`--bare`（跳过 hooks、skills、plugins、MCP 发现、auto memory 和 CLAUDE.md）被文档称为脚本和 SDK 调用的推荐模式，并且"将在未来版本成为 `-p` 的默认"。`-p` 的起始权限模式现在取决于 provider 和遥测设置。API 重试耗尽或畸形工具调用导致的死亡此前被报告成 `completed`，从 TS SDK 0.3.204（约 07-07）起写在 `terminal_reason` 的 `api_error`、`malformed_tool_use_exhausted` 等值里（[headless 文档](https://code.claude.com/docs/en/headless)；[TS SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md)）。模型别名也换了目标：`opus` 在 09-22 指向 Opus 5.5，`sonnet` 在 09-28 指向 Sonnet 5.5，`haiku` 在 10-07 指向 Haiku 5.5（[model-config 文档](https://code.claude.com/docs/en/model-config)）。Agent SDK 本身是"运行 Claude Code 二进制的库"，一个会话对应一个长驻子进程；它 2026 年的新增几乎都是把从文字里猜的状态换成带类型的字段（`terminal_reason`、`tool_result_meta`、`background_tasks_changed`、`run_id`），费用数字是按构建时打包的价格表在本地估算的（[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)；[cost-tracking 文档](https://code.claude.com/docs/en/agent-sdk/cost-tracking)）。

Managed Agents 在 2026-04-08 进入公测，到 10 月仍是 beta。开发者定义 agent（模型、system prompt、工具、MCP、skills）和环境，Anthropic 运行循环、沙箱、事件日志和 compaction；token 按标价计费，另加运行时间 **每 session-hour $0.08**，空闲不计（[platform release notes](https://platform.claude.com/docs/en/release-notes/overview)；[Pricing](https://platform.claude.com/docs/en/about-claude/pricing)）。架构上它把会话（追加式事件日志）、harness（循环）和沙箱拆开，harness 无状态，凭据不进沙箱；Anthropic 报告拆分后 p50 首 token 时间降了约 60%，p95 降了 90% 以上（[Scaling Managed Agents](https://www.anthropic.com/engineering/managed-agents)，经摘要式抓取）。它在补齐和 Claude Code 相同的词汇，隔离方式却不同：子代理共享一个沙箱，只能委派一层，最多 25 个子线程；Outcomes 会另起一个上下文独立的 grader 按 rubric 评分；session budget 触顶时会话进入空闲，调高预算后可续跑（Claude Code 的 `--max-budget-usd` 则是直接结束）；10-09 加入了 dynamic workflows（[multiagent orchestration 文档](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration)；[define-outcomes 文档](https://platform.claude.com/docs/en/managed-agents/define-outcomes)；[budgets 文档](https://platform.claude.com/docs/en/managed-agents/budgets)）。用 API key 的账户能用本地的全部编排（子代理、fork、workflows、hooks、沙箱、auto mode），用不了云端会话、routines、ultrareview 这类要 claude.ai 订阅登录的托管功能；API 账户的托管选项就是 Managed Agents（[feature-availability 文档](https://code.claude.com/docs/en/feature-availability)）。

Anthropic 公开的设计理由前后一致：harness 的每个部件都编码了一条"模型自己做不到什么"的假设，模型变强后要删。它报告为 Opus 5、Fable 5 一代删掉了 Claude Code **80% 以上的 system prompt**，自家编码评测上没有可测的损失；它把 prompt cache 命中率当可用性指标，命中率过低会宣布 SEV（[The new rules of context engineering](https://claude.dev/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models/)；[Prompt caching is everything](https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/)，均经摘要式抓取）。反面的证据来自它自己的 4 月 23 日复盘：三处 harness 改动让 Claude Code 变差，分别是默认 effort 从 `high` 降到 `medium`、一个本该空闲一小时后清一次旧 thinking 却每轮都清的缓存优化、以及 system prompt 里一行限制输出长度的话。那行话在更大的消融里使 Opus 4.6 和 4.7 掉了 3%，缓存 bug 则通过了代码审查、单元测试、端到端测试和内部试用（[April 23 postmortem](https://www.anthropic.com/engineering/april-23-postmortem)，经摘要式抓取）。它没有公布的东西同样值得记住：归因到某个编排功能的任务成功率增量，只有 Outcomes 的"最多 +10 分"和 code review 的"token −25%"，都没有给方法；workflows、fork、agent teams 能提升成功率的说法是定性论证。

## Claude API 在 9 月拿掉了自建循环常用的三样东西：强制工具调用、关闭 thinking、改写历史

当前一代是 Fable 5.1（`claude-fable-5-1`，2026-09-01）、Opus 5.5（`claude-opus-5-5`，09-22）、Sonnet 5.5（`claude-sonnet-5-5`，09-28）和 Haiku 5.5（`claude-haiku-5-5`，10-07），都是 1M 上下文、128K 最大输出、adaptive thinking（[Models overview](https://platform.claude.com/docs/en/about-claude/models/overview)）。每百万 token 的输入/输出价：Opus 5.5 为 **$4 / $20**（Opus 5 是 $5 / $25），Sonnet 5.5 $2 / $10，Fable 5.1 $10 / $50，Haiku 5.5 在 prompt 不超过 10 万 token 时 $0.10 / $0.50。缓存读取倍率不再统一：Fable 5.1 是输入价的 0.025 倍，Opus 5.5 和 Sonnet 5.5 是 0.05 倍，其余 0.1 倍（[Pricing](https://platform.claude.com/docs/en/about-claude/pricing)）。5 分钟写入是 1.25 倍，所以 Opus 5.5 上一次缓存未命中等于同一前缀 25 次读取的钱。Opus 5.5 的默认 effort 是 `medium`（Opus 5 是 `high`），不显式设 effort 的 harness 在迁移时行为会变（[Effort](https://platform.claude.com/docs/en/build-with-claude/effort)）。Sonnet 4.5 已在 09-30 弃用，**2026-11-30 退役**（[Model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations)）。

**强制工具调用。** 两份笔记指向同一处一手来源，而且读的是原文。笔记把 API release notes（09-01、09-22 两条）和 "Thinking in tool and multi-turn workflows" 页一并列为出处，引文是：在 Fable 5.1、Mythos 5.1、Opus 5.5 和 Sonnet 5.5 上，`tool_choice` 的 `{"type": "any"}` 和 `{"type": "tool", ...}` "return a 400 error. `auto` and `none` are unchanged. To guarantee schema-conformant tool inputs, use strict tool use or structured outputs."；在更早的 adaptive-thinking 模型上，强制工具调用被接受，并且 "skips thinking: the response starts with the tool call"（[API release notes](https://platform.claude.com/docs/en/release-notes/overview)；[Thinking in tool workflows](https://platform.claude.com/docs/en/build-with-claude/thinking-tool-workflows)）。另一份笔记给的生效日期是 09-01（Fable 5.1 / Mythos 5.1）、09-22（Opus 5.5）和 09-28（Sonnet 5.5），都是各模型的发布日。笔记引用的句子里没有附加条件，例如没有"仅当 thinking 开启时"这样的限定；被点名的也只有这四个模型，Haiku 5.5、Opus 5、Sonnet 5 和更早的模型不在其列。可以放在一起读的一个事实是：Opus 5.5、Sonnet 5.5 和 Fable / Mythos 5.x 对 `thinking: {"type": "disabled"}` 同样返回 400，这几个模型上 thinking 关不掉（[Thinking: configuring thinking](https://platform.claude.com/docs/en/build-with-claude/thinking#configuring-thinking)）。另有两处独立的限制也拒绝强制 `tool_choice`：on-demand compaction 请求和 programmatic tool calling（[Compaction on demand](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand)；[Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)）。

**thinking 和历史。** `thinking.type: "enabled"` 加 `budget_tokens` 从 Opus 4.7 起返回 400；Opus 4.7 及之后的模型上非默认的 `temperature`、`top_p`、`top_k` 返回 400，而 `top_p` 的默认值是 0.99，所以传 1 也是 400；Claude 4.6 及之后拒绝预填充的最后一条 assistant 消息（[Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)；[Thinking: sampling parameters](https://platform.claude.com/docs/en/build-with-claude/thinking#sampling-parameters)；[Thinking: limits](https://platform.claude.com/docs/en/build-with-claude/thinking#limits-and-feature-compatibility)）。从 Fable 5.1 起，API 对回放的每个 thinking block 做两项检查：产生它的模型，以及它之前发送的全部内容；执行前缀检查的模型是 Fable 5.1、Opus 5.5、Sonnet 5.5 和 Haiku 5.5（这份名单经摘要式抓取转述）。顶层 `system`、`tools` 或之前的消息只要变了，该 block 和之后所有 thinking block 失效，API 要么返回 400 要么丢弃它们，由 `thinking.block_binding.prefix_mismatch_behavior` 决定（[Preserved thinking](https://platform.claude.com/docs/en/build-with-claude/thinking#preserved-thinking)）。**执行范围有条件**：前缀检查对 2026-08-31 00:00 UTC 之后创建的账户默认执行，老账户只在请求设置了该参数时执行；文档的建议是不论账户年龄都做成 append-only。老账户可以在 beta header `thinking-binding-controls-2026-08-01` 下读响应里的 `input_transformations`，其中的 `thinking_mismatch_allowed` 条目指出"没通过前缀检查、但当前未被执行"的 block，用来在生产流量里数出历史被改写的次数（[API release notes](https://platform.claude.com/docs/en/release-notes/overview)）。文档点名会失败的做法是客户端自己写摘要并保留尾部若干轮（keep-tail）；经摘要式抓取转述的清单还包括清除或截短较早的 `tool_result`、重新渲染第一条用户消息。安全的做法是追加消息、用服务端 compaction 或 context editing，或者用摘要替换整段历史（[Preserved thinking: keep-tail compaction](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#keep-tail-compaction)）。丢 thinking 有可测的代价：Anthropic 在一个多轮编码基准上自测（harness 未注明），第一轮之后每轮都丢，输出 token 在 `medium` 增加 9.7%，在 `max` 增加 67.1%（[Preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking)）。

**不报错的终态。** Opus 5.5 把工具调用之间的叙述放进 progress-update thinking block。文档警告，无人值守时其中一些更新会以文本而非工具调用结束这一轮（`stop_reason: "end_turn"`），把这样的一轮当作任务结束的循环会停在那里；建议把纯文本的 end_turn 当作一次汇报，用模型维护的清单或一个更小的检查模型来决定是否继续（[Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5#unattended-agentic-runs)）。拒答是另一种不报错的终态：Fable 5 / 5.1、Opus 5 / 5.5、Sonnet 5.5、Haiku 5.5 的安全分类器会以 HTTP 200 加 `stop_reason: "refusal"` 结束请求，`stop_details.category` 取 `cyber`、`bio`、`frontier_llm`、`reasoning_extraction`、`general_harms` 或 `null`（[Refusals and fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback)）。对审查类 agent 最相关的是 `reasoning_extraction`。文档列出的触发写法包括让模型在回答前填写 `<thinking>`、`<reasoning>` 或 scratchpad 段落，以及 JSON 输出或工具输入里的 `reasoning`、`thinking`、`trace` 字段；这类拒答计费，没有推荐的 fallback 模型，文档的说法是改 prompt 而不是重试。`frontier_llm` 的定义写明良性的机器学习工作也可能触发；自 2026-09-24 起，`bio`、`frontier_llm`、`reasoning_extraction` 三类在没有任何输出时也恢复计费（[Refusals and fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback#keep-reasoning-in-thinking-blocks)；[API release notes](https://platform.claude.com/docs/en/release-notes/overview)）。服务端的 `fallbacks` 参数不会传进工具执行内部发起的模型调用，子代理要各自配置。

**缓存和上下文。** 缓存是对 `tools` → `system` → `messages` 的逐字节前缀匹配，最多 4 个断点，TTL 5 分钟（写入 1.25 倍）或 1 小时（2 倍）。寿命从写入或读取它的那次请求**开始时**算起，生成耗时也计入（[Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)）。2026 年新增的东西基本都是为了让 harness 不必改前缀：automatic caching（02-19）、mid-conversation system messages、`clear_at: "next_user_message"` 的单轮提醒、inline tool 变更、按消息改 effort，以及 09-23 转正的 cache diagnostics。后者在请求里带 `diagnostics.previous_message_id`，响应给出 `model_changed`、`system_changed`、`tools_changed`、`messages_changed` 等未命中原因（[Cache diagnostics](https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics)）。Anthropic 的成本指南给了可对照的生产数字：一整天真实流量里，agent 循环的输入中位数 **84% 读自缓存**，前 10% 的 harness 达到 94% 以上，低于约 80% 就该找破坏缓存的东西；system prompt 开头一行 25 token 的状态信息让一次运行从 $0.59 变成 $4.24，比关掉缓存还贵（[Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)）。上下文裁剪方面，服务端有阈值 compaction、09-14 上线的 on-demand compaction 和 context editing 三个 beta。同一份指南测到，在 20 个 issue 的短任务上 context editing 多花 74%；在长任务上，"在任务边界把过时的大块工具结果换成一行摘录"省了 39%（[Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence#trim-input-and-context-tokens)）。还有一处会让旧估算失准：Opus 4.7 及之后的模型用新 tokenizer，同样文本约多 30% token（[Pricing](https://platform.claude.com/docs/en/about-claude/pricing)）。

同一份成本指南也给多代理设计划了边界，这些都是 Anthropic 在 Claude 模型上的自测，笔记没有记下所用 harness。orchestrator 只在两种被测情形下省钱。一种是工作量超过一个上下文窗口：2,160 万 token 的语料、130 个植入缺陷，orchestrator 配置约 2.3 小时跑完，成本约为单模型的一半，质量比单独的前沿模型低 10–12 分。另一种是给例行工作的成本尾部上保险。其余每一次，同一个模型降低 effort 都更便宜。"先用 `low` 跑，失败的再用 `high` 重跑"在 Opus 5.5 上以每任务约 $0.17 达到约 97% 通过率，全部用 `high` 是 $0.29、95.3%；前提是检查器不放过坏结果（[Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)）。

## DeepSeek 有了自己的 harness，API 只剩两个 id，其中一个的去向官方页面自相矛盾

### DeepSeek Harness 用两个工具的 minimal 模式给自家模型跑分

DeepSeek Harness（`dsh`）是 MIT 许可的开源 agent harness。README 自述为 "everything-is-a-plugin" 架构，处于 developer preview，并警告 "THERE WILL BE COMPATIBILITY-BREAKING CHANGES"；用 `npx @deepseek-ai/dsh web` 启动本地 Web UI（[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)）。媒体把首发记在 2026-08-13（v0.1），DeepSeek 自己 08-21 的发布说明提到 0.1.1；09-25 出了桌面应用，之后几乎每天一个预发布，最新是 10-09 的 `dsh-v0.2.1-alpha.2`（[datanorth.ai](https://datanorth.ai/news/deepseek-releases-v4-pro-0813-and-harness-v0-1)；[Vision-Exp Release](https://api-docs.deepseek.com/news/news260821)；[IT之家 via 凤凰网](https://tech.ifeng.com/c/8whhG6Qax9g)；[releases](https://github.com/deepseek-ai/deepseek-harness/releases)）。它有四个预设：Standard（完整编码 agent）、PTC（模型写 TypeScript 程序串联工具调用）、Minimal（只有持久 bash 和文件编辑器）、Creator。release notes 里能读到的结构包括默认最多 8 个存活子代理、委派深度 1、实验性的 Team 模式和 Computer Use、追加式会话日志；第三方模型目录建在 pi-ai 0.87.1 上（[releases](https://github.com/deepseek-ai/deepseek-harness/releases)）。DSH 仍是预览版，25 天里十个预发布，几次改了会话日志格式和 adapter 协议，现在钉不住版本。

两处细节对自建者有参考价值。其一，DeepSeek 的官方 adapter 在发布六周内放弃了 Chat Completions：09-15 把 Messages 设为默认协议，09-23 起"只用 Messages API"，期间还修过"子代理完成通知里的 reasoning block 导致父会话 Messages 请求失败"（[releases](https://github.com/deepseek-ai/deepseek-harness/releases)）。这是关于 DeepSeek 自己在 agent 循环上测得最多的端点的最强线索。其二，DeepSeek 自己的 scaffold 对比表里极简 harness 领先。该表是厂商自报，模型为 V4.1-Flash、max effort，两个数依次是 DeepSWE v1.1 和 Terminal-Bench 2.1：mini-SWE 74.2 / 90.3，DSH Minimal 72.6 / 90.6，DSH Standard 70.5 / 85.8，Claude Code 69.8 / 88.0，DSH PTC 67.6 / 85.8，Pi 66.2 / 86.1，Codex 65.6 / 84.1，OpenCode 65.5 / 85.0（[HF DeepSeek-V4.1-Flash](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash)）。同一权重在不同 harness 间差 8.7 分和 6.5 分，自家功能齐全的预设不如自家极简预设。这是一家厂商在一个模型上的测量，自己的 harness 还是参赛者，只能当作关于 V4.1-Flash 的证据。

### 两个模型 id、峰谷定价，和不报错的别名

API 文档现在只列两个 id：`deepseek-flash`（DeepSeek-V4.1-Flash，2026-09-10 发布，支持图像）和 `deepseek-v4-pro`（DeepSeek-V4-Pro-0813，仅文本）。两者都是 1M 上下文、384K 输出上限，thinking 默认开启。价格分峰谷，谷价是峰价的一半；峰时是北京时间工作日 9:00–12:00 和 14:00–18:00，即 **01:00–04:00 和 06:00–10:00 UTC**（[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)；[Rate Limit](https://api-docs.deepseek.com/quick_start/rate_limit)）。

| 每百万 token，峰 / 谷（USD） | 缓存命中输入 | 缓存未命中输入 | 输出 | 账户并发上限 |
|---|---|---|---|---|
| `deepseek-flash` | 0.006 / 0.003 | 0.30 / 0.15 | 1.20 / 0.60 | 2,500 |
| `deepseek-v4-pro` | 0.044 / 0.022 | 1.32 / 0.66 | 3.96 / 1.98 | 500 |

这是 8 月涨价之后的价。据 InfoWorld（二手来源），此前 V4-Pro 是 $0.435 / $0.87 的平价，这次缓存命中价涨了 52%–1,100%（[InfoWorld](https://www.infoworld.com/article/4209439/deepseek-raises-some-v4-prices-by-more-than-10x-as-ai-demand-strains-capacity.html)）。id 的历史对运营者更要紧。`deepseek-chat` 和 `deepseek-reasoner` 已在 2026-07-24 退役；`deepseek-v4-flash` 的权重在 07-31 于同一 id 下被换过一次；`deepseek-v4-flash-vision-exp` 08-21 上线、09-10 退役，寿命 20 天。两个旧名现在"仍被接受"，请求由 V4.1-Flash 服务并按 Flash 计费，别名没有给出终止日期（[Change Log](https://api-docs.deepseek.com/updates)；[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)）。别名是静默的：请求旧 id 得到的是另一个模型的 200，所以改名只能靠读定价页、changelog 或做能力探针发现，错误码发现不了。通过第一方 API 也钉不住权重，带版本号的只有 Hugging Face 上 MIT 许可的权重仓库（`-0731`、`-0813`）（[HF deepseek-ai](https://huggingface.co/deepseek-ai)）。

### `deepseek-v4-pro` 现在由谁服务：发布稿和 changelog 说法相反

研究笔记在这一点上互相矛盾，矛盾的根源是 DeepSeek 自己的页面。

**说法一：9 月 14 日起全部路由到 V4.1-Flash。** `benchmarks_and_field.md` 依据的是 DeepSeek 2026-09-10 的 V4.1-Flash 发布稿。这篇稿子在 10-12 抓取时仍写着："Starting at 04:00 UTC on Sept 14, 2026, all `deepseek-v4-pro` requests will route to V4.1-Flash at V4.1-Flash rates." "This will continue until V4.1-Pro launches."（[V4.1-Flash Release](https://api-docs.deepseek.com/news/news260910)；[中文版](https://api-docs.deepseek.com/zh-cn/news/news260910)）。该笔记由此推断：9 月 14 日之后经 DeepSeek 自家 API 得到的任何"V4 Pro"结果都是 V4.1-Flash 的结果。当天的二手报道标题也是 "retires V4-Pro"（[The Next Web](https://thenextweb.com/news/deepseek-v4-1-flash-launch-v4-pro-retired-price-cut)）。

**说法二：V4 Pro 继续单独提供，计费不变。** `deepseek_models_api.md` 依据的是同一天的 changelog 条目在 10-12 的写法：「我们决定在 2026 年 9 月 14 日之后继续提供 DeepSeek V4 Pro 的 API 调用服务，计费方式保持不变」（[更新日志](https://api-docs.deepseek.com/zh-cn/updates)；[Change Log](https://api-docs.deepseek.com/updates)）。旁证有两张一手页面：定价页把 `deepseek-v4-pro` 列为 "DeepSeek-V4-Pro-0813"，有自己更高的价格，Vision 一栏是 "Not supported"；状态页把 "DeepSeek V4 Pro API" 和 "DeepSeek V4.1 Flash API" 当作两个组件分别统计（[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)；[status.deepseek.com](https://status.deepseek.com/)）。反转的日期只有一个第三方追踪站给出：2026-09-11，定价页脚注被换成"应用户需求，我们决定继续提供……如有变化将另行通知"（[usagepricing.com](https://www.usagepricing.com/blueprint/activity/deepseek-2026-09-11-v4-pro-retirement-reversed)）。第三份笔记 `deepseek_in_harnesses.md` 采用的也是这一说法。

**哪些是一手，哪些没定。** 发布稿、changelog、定价页、状态页都是 DeepSeek 的一手页面，它们之间不一致；追踪站和 The Next Web 是二手。三张一手页面支持说法二，其中定价页是实际生效的价目表，唯一支持说法一的是一篇没被更正的公告，所以更可能的现状是 V4-Pro-0813 仍在单独服务。这个判断没有被证实：反转没有一手的日期戳，发布稿至今没改，研究者没有发任何 API 请求，`/models` 的实际返回也没抓；所有 DeepSeek 页面都是经摘要式抓取读的。

**怎么自己验证。** 有四个便宜的办法，可以叠加。第一，对 `deepseek-v4-pro` 发一次小请求，然后在 DeepSeek 控制台的账单明细里看单价对上哪张价目表：未命中输入 $1.32 / $0.66 对 $0.30 / $0.15，输出 $3.96 / $1.98 对 $1.20 / $0.60。第二，做能力探针：给 `deepseek-v4-pro` 发一张现场生成的随机数字图片。V4.1-Flash 能看图，V4-Pro-0813 不能；文档没写给它发图片时 API 返回 400 还是丢弃图片，所以要看数字读没读对，不能看状态码。第三，看流式输出速度：Artificial Analysis 在第一方 API 上测到 V4 Pro 0813 约 92–94 token/s，V4.1-Flash 约 205 token/s；负载会影响速度，这条只作旁证（[AA V4 Pro providers](https://artificialanalysis.ai/models/deepseek-v4-pro/providers)；[AA V4.1-Flash](https://artificialanalysis.ai/models/deepseek-v4-1-flash)）。第四，用浏览器直接打开发布稿、changelog 和定价页，看发布稿是否已被更正，并读响应里的 `model` 字段和 `/models` 列表。

这件事影响三处判断：`deepseek-v4-pro` 这个 id 有没有视觉能力，它的单价，以及 9 月 14 日之后任何标着"V4 Pro"的第一方 API 测量到底在测哪个模型。Artificial Analysis 的 Codex 条目用的是 09-03 / 09-04 的 Codex 构建，早于这两个日期。不论哪种说法为真，`deepseek-v4-pro` 都处在明确的预告期：DeepSeek 称它 "phasing out"，一天左右又"应用户需求"撤回，承诺的只有"另行通知"，changelog 里也没有 V4.1-Pro 的公告。

### thinking、工具和缓存的规则与 Claude 不同，不支持的字段多数被静默忽略

**thinking 与工具。** thinking 默认开启，effort 默认 `high`。开关是 `thinking: {"type": "enabled"|"disabled"}`，`reasoning_effort` 取 `low` / `high` / `max`，外来值会被映射（`medium` 和 `xhigh` 都落到 `high`）；thinking 模式下 `temperature` 等采样参数不报错也不生效（[Thinking Mode guide](https://api-docs.deepseek.com/guides/thinking_mode)）。打断过几乎所有第三方 harness 的是回传规则：请求带 `tools` 时，此前每一轮 assistant 的 `reasoning_content` 都要回传，包括没有调用工具的那些轮，否则 API 返回 400；不带 `tools` 时不需要回传，传了也被忽略。

关于强制工具调用，Chat Completions 参考页的原话（经摘要式抓取转述）是："`required` and named tool choices are not supported in thinking mode; the API returns a `400` error."（[Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion)）。条件就是"thinking 模式下"，而 thinking 是默认状态。文档没有说这条限制是否同样适用于 Anthropic 端点的 `any` / `tool` 或 Responses API 的 `required`；Anthropic 端点的指南只把 `none` / `auto` / `any` / `tool` 列为支持，没有提 thinking（[Anthropic API guide](https://api-docs.deepseek.com/guides/anthropic_api)）。第三方的 Pydantic AI 文档给出了错误文本 "Thinking mode does not support this tool_choice"，并建议要可靠的结构化输出就关掉 thinking，否则退回 `auto`；它还提到在 `deepseek-v4-pro` 上用 `auto` 时，模型以散文作答而不调用输出工具的情况多到足以耗尽重试预算（[Pydantic AI](https://pydantic.dev/docs/ai/models/deepseek/)）。其余几条：严格模式（`strict: true`）是 Beta，要走 `https://api.deepseek.com/beta`，只接受受限的 JSON Schema 子集；三个端点都关不掉并行工具调用；`response_format` 只有 `text` 和 `json_object`（[Tool Calls guide](https://api-docs.deepseek.com/guides/tool_calls)；[Responses API guide](https://api-docs.deepseek.com/guides/responses_api)）。

**缓存。** DeepSeek 的缓存是自动的、基于前缀的磁盘缓存，没有断点也没有 cache key，价目表里没有写入费或存储费这一行，保留时间只说"通常几小时到几天"。命中要求完整匹配一个已持久化的 "cache prefix unit"；一个全新的公共前缀通常要被见过并持久化之后才命中（[Context Caching guide](https://api-docs.deepseek.com/guides/kv_cache)）。命中价是未命中价的 2%（Flash）和 3.3%（V4-Pro）。用量字段是 `usage.prompt_cache_hit_tokens` 和 `prompt_cache_miss_tokens`；`user_id` 用于 "KVCache isolation"；Anthropic 格式的 `cache_control` 在所有 block 上都被忽略（[Rate Limit](https://api-docs.deepseek.com/quick_start/rate_limit)；[Anthropic API guide](https://api-docs.deepseek.com/guides/anthropic_api)）。

**兼容端点。** 一个后端提供三种线格式：Chat Completions、无状态的 Responses API、以及 `https://api.deepseek.com/anthropic` 上的 Anthropic Messages。Anthropic 端点按前缀映射模型名：以 `claude-opus` 开头的映射到 `deepseek-v4-pro` 并按其价格计费，`claude-sonnet`、`claude-haiku` 和不认识的名字都映射到 `deepseek-flash`。`anthropic-version` 被忽略；`budget_tokens`、`disable_parallel_tool_use`、`tool_result.is_error`、`cache_control` 都被忽略而不报错（[Anthropic API guide](https://api-docs.deepseek.com/guides/anthropic_api)）。DeepSeek 给 Claude Code 的官方配置把所有槽位（包括 Opus 槽）都放在 `deepseek-flash`，effort 设 `max`，自动 compaction 窗口设 786,432，即 1M 的 75%（[Claude Code integration guide](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code)）。

**运营。** 真正的限制是账户级并发（见上表），超出返回 429。负载高时服务端保持连接并发送 keep-alive，非流式是空行，流式是 `: keep-alive` 注释；10 分钟还没开始推理才断开。402 是余额不足。`finish_reason` 里有 `insufficient_system_resource` 和 `aborted` 两种随 200 返回的失败（[Rate Limit](https://api-docs.deepseek.com/quick_start/rate_limit)；[Error Codes](https://api-docs.deepseek.com/quick_start/error_codes)；[Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion)）。官方状态页显示 2026 年 7–10 月 V4 Pro API 可用率 99.92%，V4.1 Flash API 99.69%；具体事故只有第三方记录（[status.deepseek.com](https://status.deepseek.com/)）。

## Claude Code 在 10 月 1 日推出 Mods，DeepSeek 两天后做了一个兼容层

本节是报告完成后补的。依据是 2026-10-13 直接下载的原文：Claude Code 的 changelog 和 Mods 文档，DeepSeek Harness 的 release notes、兼容性文档和包 README，都没有经过摘要式抓取。两边的代码都没有实际运行；文中提到的 Anthropic 博文没有打开，只见于 DeepSeek 文档的引用。

### Mods 让插件在 Claude Code 进程内拦截工具调用、模型请求和界面

Claude Code v2.1.287（2026-10-01）的 changelog 写的是 "Added Claude Mods: plugins may now modify deeper behavior"（[CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)；[v2.1.287 release](https://github.com/anthropics/claude-code/releases/tag/v2.1.287)）。mod 是一种 plugin，由 JavaScript 或 TypeScript 的事件处理函数组成，**在 Claude Code 进程内运行**；原有的 settings hook 是进程外的 shell 命令、HTTP 请求或 prompt。处理函数的形状是 `on('tool.call', { tool: 'Bash' }, async ($, e, next) => …)`，对一个事件可以旁观（原样 `next(e)`）、改写（改完再 `next`）或接管（不调 `next`，自己作答）。文档列出它能做而 hook、skill、MCP server 做不到的事：画界面（transcript 旁的 pane、prompt 上方的 band），重画 Claude Code 自己的界面，介入一次工具调用或一次模型请求，注册不经过模型回合的 `/command`（[Mods overview](https://code.claude.com/docs/en/plugins/mods/overview)）。

对 harness 作者要紧的是三个事件（[React to events](https://code.claude.com/docs/en/plugins/mods/events)；[Mods reference](https://code.claude.com/docs/en/plugins/mods/reference)）：

- **`tool.call`** 在权限检查之前触发，覆盖子代理和 MCP 工具的调用。hook 可以拒绝、改参数、重试、不运行工具而自己给结果，或在工具跑完之后把结果扣下不给模型。
- **`turn.step`** 在每次向模型发请求之前触发。hook 能读到这次请求的 `cache_read_input_tokens` 和 `cache_creation_input_tokens`，能用 `next({ ...e, model })` 把这一次请求发给另一个模型，也能不调模型直接作答。
- **`agent.spawn`** 能拒绝子代理，v2.1.292 起包括 workflow 里的 agent。

mods API（`$`）另外提供注册工具和命令、带 prompt caching 的 `$.model.complete`、定时任务、会话间消息，以及文件、进程和网络访问（[Use the mods API](https://code.claude.com/docs/en/plugins/mods/api)）。hook 在 `claude -p` 和 Agent SDK 会话里照常运行，只是不画界面；`--bare`、`--safe-mode` 和 `disableAllHooks` 会停掉用户安装的 mod。每个 hook 处理一个事件的自身运行时间上限是 10 秒，`next` 和 `$` 调用里的时间不计。

Anthropic 把自己的几个功能也做成了 mod：`/diff` 面板、读取 `AGENTS.md`、遥测、组织策略守卫 `cc-plugin-sec-default`，以及默认关闭的 "You should know"（一个旁路 agent 盯着长任务，把用户可能漏掉的事显示在 prompt 上方）。信任模型写得很直白："Mods aren't sandboxed"。mod 以用户权限运行，能读密钥、改写 prompt 和工具调用、在用户被问到之前批准工具调用、花用户的额度。约束有两层：hooks 模块只能经 `$` 触达外部，所以 `claude plugin validate` 能在安装前静态列出它处理哪些事件、发起哪些调用；组织 managed settings 里的 hook 先于任何 mod 的 `tool.call` 运行，它的拦截是最终的。这个功能还很新：此后到 v2.1.296 的九个版本里有 56 条 mod 相关的 changelog 条目，其中 39 条是修复，有两条是"用户安装的 mod 能让组织的守卫跳过检查"这一类。

### DeepSeek 一侧是两样东西：原生的插件系统，和一个证明"Mods 是子集"的桥

DSH 本来就是插件系统。仓库描述是 "DeepSeek Harness: Everything is a Plugin."，建在 Cordis 上，8 月首发时就是这个形状；按 Composio 的二手描述，agent 循环本身也是一个可替换的插件（[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)；[Composio](https://composio.dev/content/deepseek-harness-vs-claude-code)）。所以和 Mods 对应的原生能力，DSH 早两个月就有。

**10 月 3 日**的 v0.2.1-alpha.1 加的是另一样东西：`@deepseek-ai/dsh-experimental-claude-code-mods`，用 `defineMod` 把一个 Claude Code mod 的 `register` 函数包成 Cordis 插件，沿用同一条 `$`、`e`、`next` 链。release notes 把目的写得很明白："At this stage, the main goal is to verify that the Claude Code Mods API's capabilities are broadly a subset of what DeepSeek Harness plugins can do, rather than to offer users complete, practical compatibility."（[releases](https://github.com/deepseek-ai/deepseek-harness/releases)）。它自己的兼容性文档逐项列出了与 Claude Code 2.1.287 的差异（[claude-code-mods 兼容性文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/claude-code-mods.md)；[包 README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/experimental/claude-code-mods/README.md)）：

| | Claude Code Mods | DSH 的桥（v0.2.1-alpha.2，10-09） |
|---|---|---|
| 形态 | plugin 目录，`hooks.json` 指向 hooks 模块；有热重载、`claude plugin validate`、`claude plugin test` | `defineMod` 包成 Cordis 插件，经 cordis.yml 挂载；不读 `plugin.json` 和 `hooks.json`，无热重载 |
| `tool.call` | 权限检查之前；可拒绝、改参数、重试、自己作答、扣下结果 | 在 harness 的权限决定之后；可拒绝、自己作答、改写结果；改参数或改派到别的工具的 hook 被跳过并报告，理由是 "the logged call runs as logged" |
| `turn.step`（逐请求读用量、换模型） | 有 | 不触发 |
| `tool.check`、`agent.*`、`classic.*` | 有 | 前两类注册后从不触发，加载时给警告；`classic.*` 在注册时被拒 |
| `$.model`、`$.agent` | 有 | 拒绝，报 `no implementation` |
| 界面 | pane、band 和各个渲染位点 | 只有 prompt 上方的 band |
| 访问约束 | hooks 模块只能经 `$` 触达宿主；分 user / project / managed 层 | 没有访问规则，拥有进程的全部权限；一律按 user 层加载 |
| 能跑什么 | — | Anthropic 博文的三个示例能跑（Token Weather 的模块、类型和测试原样不改）；Anthropic 自己的四个内置 mod（`diff`、`agents-md`、`sec-default`、`telemetry`）都标为 "Not runnable" |

两者方向相反。Claude Code 的循环是封闭的，Mods 是在封闭的核上开出一组受控的拦截点；DSH 的核本来就开放，桥是把别人的拦截点 API 映射到自己的插件机制上，用来说明自己是超集。按它自己的文档，这个说明只完成了一部分：逐请求的模型路由、子代理事件和 `$.model` 都没接上；在工具执行前改写参数，DSH 现在做不到，文档指向的是一份 6 月 30 日的提案。桥没接上某个事件不等于 DSH 原生插件做不到，所以"子集"这个说法目前既没被证实也没被否定。`$.model.complete` 没接上的理由值得注意：DSH 要求 mod 发起的模型调用也能从会话日志重建，在有对应的日志事件之前不提供。

这个包的 README 里有一节 "Model Experience"，逐项写明 mod 的每种行为让模型看到什么、对 token 的影响、对 KV cache 的影响，例如追加的上下文 "follow the reusable request prefix and do not invalidate existing entries"。把"这个扩展对缓存前缀做了什么"写成每个扩展必填的一栏，是这两个月里看到的最具体的缓存纪律。

对把 `claude -p` 当执行器的 harness，有一件事值得核对：mod 的 hook 在 `claude -p` 里运行，所以写入范围限制、对特定文件写入时的校验、逐请求的缓存读写记录，都可以放进一个 mod 由机制执行，不必只写在任务书里。前提是不用 `--bare`，且 hook 自身在 10 秒内返回。这一条没有测过。

## 独立测量里，Claude 在长程任务上领先 20–55 分，DeepSeek 每任务便宜 20–55 倍

基准栈在 2026 年换了一轮。SWE-bench Verified、SWE-bench Pro、Terminal-Bench 2.x、METR 的 time horizon、Aider polyglot、HAL 和 GAIA 要么饱和，要么被审计出问题，要么停止更新：Scale 的 SWE-bench Pro V2 上 Opus 5 + Claude Code（xhigh）已到 99.40%（独立），SWE-bench 官网的数据停在 2026-02-26（[Scale Labs](https://labs.scale.com/leaderboard/swe_bench_pro_public_v2?tab=full)；[swebench.com](https://www.swebench.com/)）。还有区分度的是 Terminal-Bench 4.0、OSWorld 2.0 和 Artificial Analysis（下称 AA）的 Coding Agent Index。下表每一行都写明 harness 和测量方。

| 基准与测量方 | 模型 + harness（effort） | 成绩 | 成本 |
|---|---|---|---|
| Terminal-Bench 4.0 官方榜（独立榜单，按提交机构列出） | Opus 5.5 + Claude Code（max） | 64.8% ± 3.1 | 330 次试验共 $4,719 |
| 同上 | Sonnet 5.5 + Claude Code（max） | 61.8% ± 2.9 | 共 $7,334 |
| 同上 | GPT-6 Astra + Codex（max） | 58.2% ± 2.8 | 共 $3,267 |
| 同上 | Fable 5.1 + Claude Code（max） | 57.9% ± 3.8 | 共 $6,244 |
| 同上 | GLM-5.3 + Claude Code（max） | 41.8% ± 3.2 | 共 $2,728 |
| 同上 | 任何 DeepSeek 模型 | 无条目（查了 35 行） | — |
| Terminal-Bench 4.0（厂商自报：Anthropic） | Opus 5.5 + 自家设置（xhigh） | 66.4% | — |
| Terminal-Bench 4.0（厂商自报：DeepSeek；发布表未注明 harness，模型卡称 code-agent 基准用 DSH Minimal） | V4.1-Flash / V4-Pro-0813（max） | 31.2 / 12.4 | — |
| Terminal-Bench 4.0（独立：AA） | V4 Pro 0813 + Codex（max） | 10.1% | — |
| AA Coding Agent Index v1.5（独立） | Sonnet 5.5 + Claude Code（max） | 68.4 | $14.19 / 任务，5,245 s |
| 同上 | Opus 5.5 + Claude Code（max） | 66.0 | $13.04 / 任务，3,867 s |
| 同上 | GPT-6.1 Sol + Codex（xhigh） | 62.9 | $1.04 / 任务，931 s |
| 同上 | **V4 Pro 0813 + Codex（max）** | **43.1** | **$0.24 / 任务**，2,418 s |
| 同上 | Sonnet 5.5 + Claude Code（low） | 42.1 | $0.48 / 任务，381 s |
| 同上 | V4 Flash 0731 + Codex（max） | 38.7 | $0.09 / 任务，1,097 s |
| SWE-rebench（独立，全部模型用同一个 scaffold） | Fable 5 [high] / Opus 5 [high] | 64.5% / 63.4% | $4.40 / $3.47 每题 |
| 同上 | DeepSeek-V4 Pro [high]（4 月的 Preview 版） | 40.2% | $0.15 每题 |
| SWE-bench Verified（独立：NIST CAISI，Inspect ReAct agent） | Opus 4.6（max）/ V4 Pro（max） | 79% / 74% | — |
| SWE-bench Verified（厂商自报：DeepSeek，harness 未注明） | V4-Pro-Max | 80.6 | — |
| OSWorld 2.0（独立，官方结果文件，500 步预算） | Opus 5（max，batched tool calls）；无 DeepSeek 条目 | 44.33% binary / 77.67% partial | — |
| DeepSWE v1.1（厂商自报：DeepSeek） | V4.1-Flash + mini-SWE（max）；对照的 Opus 5 未注明 harness | 74.2；74.0 | — |
| DeepSWE v1.1（独立：AA） | V4 Pro 0813 + Codex（max） | 57.2（DeepSeek 自报 62.7） | — |

来源：[tbench.ai leaderboard](https://www.tbench.ai/leaderboard)；[Anthropic, Opus 5.5](https://www.anthropic.com/claude-opus-5-5)（经摘要式抓取）；[HF DeepSeek-V4.1-Flash](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash)；[HF DeepSeek-V4-Pro](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro)；[AA Coding Agents](https://artificialanalysis.ai/agents/coding-agents)；[swe-rebench.com](https://swe-rebench.com/)；[NIST CAISI](https://www.nist.gov/news-events/news/2026/05/caisi-evaluation-deepseek-v4-pro)；[OSWorld 2.0 results](https://osworld-v2.xlang.ai/static/data/leaderboard/official-results.json)。

三点读法。第一，DeepSeek 在 Terminal-Bench 4.0 官方榜、OSWorld 2.0、SWE-bench Pro V2 和 METR 上都没有厂商提交或榜单方运行的 V4 条目。这应读成"没被测"，比"测了很差"弱；例外是 Terminal-Bench 4.0，DeepSeek 自报和 AA 独立测量都给出低分。第二，独立复现一致地比 DeepSeek 自报低 2–7 分：Terminal-Bench 4.0 上 10.1 对 12.4，DeepSWE v1.1 上 57.2 对 62.7，SWE-bench Verified 上 74 对 80.6（CAISI 把差距归因于 system prompt、scaffold 和 token 预算，它对 4 月版 V4 Pro 的总评是能力落后前沿约 8 个月）。第一方的 agent 分数应当读成"模型加它自己的 harness"的分数。第三，**V4.1-Flash 在任何 agentic 基准上都还没有独立测量**，DeepSeek 发布稿里"多方测试显示它领先 V4-Pro"没有给出处（[V4.1-Flash Release](https://api-docs.deepseek.com/news/news260910)）。

差距的大小取决于任务形状。在仓库问答上约 5 分：AA 的 SWE-Atlas-QnA 上 V4 Pro 0813 + Codex 为 61.8，Opus 5.5 + Claude Code 为 66.4，同一个 Codex harness 里的 GPT-6 Astra 也是 61.8。在新鲜的仓库修 bug 上是 10–25 分（SWE-rebench）。在多小时的终端任务上是 13–53 分，低端是 DeepSeek 自报的 V4.1-Flash 对 Opus 5，高端是 AA 测的 V4 Pro 0813 + Codex 对 Opus 5.5 + Claude Code。SWE-rebench 上 pass@5 把差距缩小了：V4 Pro Preview 64.0%，Opus 5 是 74.8%，说明重试或 best-of-n 能用 DeepSeek 的价格追回一部分（[AA Coding Agents](https://artificialanalysis.ai/agents/coding-agents)；[swe-rebench.com](https://swe-rebench.com/)）。模型代际的效应远大于 harness 效应：同在 Claude Code 里，Terminal-Bench 4.0 官方榜从 Opus 4.8 的 23.6%（5 月）到 Opus 5 的 51.8%（7 月）再到 Opus 5.5 的 64.8%（9 月）；这几个月 Claude Code 自己的版本也在变，所以这是"模型加 harness"的趋势。

成本上，DeepSeek 每任务便宜 20–55 倍，用的 token 却一样多或更多，墙上时间相当或更长。AA 的同一个指数里，V4 Pro 0813 + Codex 每任务 138 步、2,420 万 token、99.0% 缓存命中；Opus 5.5 + Claude Code 是 1,560 万 token。价差几乎全在单价和近乎免费的缓存读取上。更公平的对照是同分档：指数 42–43 分处，V4 Pro 0813 + Codex 是 $0.24、2,418 秒，Sonnet 5.5 + Claude Code（low）是 $0.48、**381 秒**，Haiku 5.5 + Claude Code（xhigh）是 $0.61。DeepSeek 便宜 2–2.5 倍，墙上时间是 Sonnet 5.5 low 的 6.3 倍（[AA Coding Agents](https://artificialanalysis.ai/agents/coding-agents)）。对串行、受延迟约束的席位，降 effort 的 Claude 是比 max effort 的 Claude 更该拿来比的对象。

### harness 对前沿模型主要改变成本，对弱模型才改变成败

对前沿模型，独立对照里 harness 让成功率变动 0–10 分，让成本变动 1.5–5 倍。Arena 的 "HarnessTax"（2026-09-16；7 个模型 × Claude Code、Codex CLI、Pi）测到 harness 对成功率的影响在 SWE-bench Lite 上不超过 ±2%，在 Terminal-Bench 2.0 上约 ±5%；Claude Code 的成本在 SWE-bench Lite 上约为 Pi 的 2.0 倍，初始上下文是 Pi 的 10 倍以上；该研究没有测 DeepSeek 模型（[Arena](https://arena.ai/blog/coding-agents-harness-tax/)）。Databricks 在私有代码库上发现，同模型同 effort 经 Claude Code 或 Codex 在某些情况下比经 Pi 每任务贵 2 倍以上，质量不变（[Databricks](https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase)）。对弱模型，摆幅是 15–30 分：Terminal-Bench 2.1 上 GPT-5.4 mini 在 Codex CLI 里 66.1%，在 Terminus 2 里 36.9%（[tbench.ai 2.1 post](https://www.tbench.ai/news/terminal-bench-2-1)）。Fan et al. 在一个 LangGraph ReAct harness 里做了最干净的消融：打开 planning 让 30B 模型在 SWE-bench Verified 上 +11.6 分（成本约 4.5 倍），让三个更大的模型 −0.4 到 −2.6 分；把预定义工具换成只有 bash，30B 模型掉 15.0 分，550B 模型反而涨 3.6 分、成本减半（[arXiv 2609.20804](https://arxiv.org/html/2609.20804v1)）。

DeepSeek 模型上的直接证据来自 Composio 的自测；它销售测试所用的 MCP 路由层，任务集和评分器没有公开。30 个多步真实应用任务里，V4 Flash 0731 在八个 harness 上通过 14–20 个（Pi 20，Claude Code 16，Codex 16，OpenCode 14），V4 Pro 0813 在六个 harness 上通过 18–21 个（Pi 21，Codex 20，DSH 20，Claude Code 19）（[InfoQ via 36Kr](https://eu.36kr.com/en/p/3936187229142153)；[Composio](https://composio.dev/content/deepseek-harness-vs-claude-code)）。更强的模型上摆幅减半，这和"harness 对弱模型更要紧"方向一致，也可以用天花板效应和 n=30 的噪声解释。公开资料里没有任何实验把同一套脚手架消融同时施加在一个 DeepSeek 模型和一个 Claude 模型上，所以这个命题对这一对模型**没有被证实**。专门针对"独立写测试的 agent"或审稿 agent 的受控证据也很薄，支持是间接的：Anthropic 报告 agent 给自己的工作打分时系统性偏高；Kim et al. 发现没有集中验证的架构传播更多错误；榜单方自己在加外部复核，Scale 在干净镜像上重新评每个 diff，并抓到过 Opus 5 往 go.sum 里伪造校验和（[Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)，经摘要式抓取；[arXiv 2512.08296](https://arxiv.org/abs/2512.08296)；[Scale Labs](https://labs.scale.com/leaderboard/swe_bench_pro_public_v2?tab=full)）。重编排也有被测到的代价：同一篇 Kim et al. 里，多代理在可分解任务上 +80.8%，在顺序规划上 −70.0%。

### DeepSeek 在 agent 循环里的主要故障是协议层的，其次是静默结束的轮次

以下是现场报告，多数是单一来源的个案，分量低于上面的受控测量。4–6 月打断几乎所有 harness 的是 `reasoning_content` 回传规则：OpenCode、Cursor、Claude Code 的各种中继、Zed 都撞过，典型表现是第一次工具调用成功、第二步 400；在一次个人基准里 OpenCode 把这个错误藏了起来，静默回退到跑在 Opus 4.7 上的 agent，那次"DeepSeek"运行的作者是混的（[opencode #24122](https://github.com/anomalyco/opencode/issues/24122)；[AkitaOnRails](https://akitaonrails.com/en/2026/05/04/llm-benchmarks-deepseek-unlocked-deepclaude/)）。

第二类是以 HTTP 200 结束却没有任何可执行内容的轮次，三份报告、三种成因。Claude Code 经中继接 `deepseek-v4-pro` 的 Anthropic 端点时，工具调用成功后的最后一条消息 `stop_reason=end_turn` 且只有一个 thinking block（5 个用户；后来有人用非 DeepSeek 的 provider 复现了同样形状，中继可能也有责任）（[cc-switch #3654](https://github.com/farion1231/cc-switch/issues/3654)）。Hermes Agent 上 46 次响应里有 22 次完全为空（`content=""`、`reasoning_content=""`、`completion_tokens=0`），都发生在上下文里有 tool 消息的轮次，1–2 秒返回（[DeepSeek-V3 #1453](https://github.com/deepseek-ai/DeepSeek-V3/issues/1453)）。消息列表以 `role: "system"` 结尾时，DeepSeek 的 Anthropic 兼容层返回 `content: []` 加 `end_turn`，这是报告者的假设，未获确认（[new-api #5411](https://github.com/QuantumNous/new-api/issues/5411)）。

第三类是延迟。非流式调用在默认 thinking 下，首字节时间等于全部推理时间：约 0.9K / 1.9K / 2.9K 输入 token 时是 15.4 / 22.0 / 31.8 秒，关掉 thinking 后同一调用 2.7 秒（[DeepSeek-V3 #1464](https://github.com/deepseek-ai/DeepSeek-V3/issues/1464)）。AA 在第一方 API 上测到 V4 Pro 0813 在 max effort 下到第一个答案 token 要 23.47 秒，其中约 21 秒是 thinking（[AA V4 Pro providers](https://artificialanalysis.ai/models/deepseek-v4-pro/providers)）。

缓存方面，上下文只追加的 harness 报告的命中率是 85% 以上到 99.93%（后者是 Pi + V4 Flash 上近 10 亿输入 token，实付 $2.65，估计未缓存要 $132），AA 在 Codex 里测到 99.0%（[InfoQ via 36Kr](https://eu.36kr.com/en/p/3936187229142153)；[Howard Chen](https://howardchen.substack.com/p/deepseek-v4-pro-at-5-the-cost-of)）。账单由路由和缓存行为决定，标价其次：一次单任务对比里，V4 Pro 经 OpenRouter 接进 Claude Code 花了 $3.38，Opus 4.7 在 OpenCode 里约 $1.10，原因是 OpenRouter 路线丢掉了缓存标记（[AkitaOnRails](https://akitaonrails.com/en/2026/05/04/llm-benchmarks-deepseek-unlocked-deepclaude/)）。

图像方面，公开证据支持的是"失败或被换成占位符"：经 OpenRouter 给纯文本的 V4 checkpoint 发 `image_url` 会失败，不会丢掉图片继续（[OpenRouter](https://openrouter.ai/blog/insights/deepseek-v4-vision/)）。研究者没有找到纯文本 DeepSeek 模型凭空描述图片内容的公开报告，第一方 API 的行为文档也没写，这只能自己测。质量方面有一篇独立论文：电信排障基准 CTBench 上 HermesAgent + DeepSeek-V4-Pro 的根因准确率是 17.46% ± 3.4%，Codex + GPT-5.5 是 47.62%，每任务约 145–149 万 token；摘要说 agent 常给出看似合理、却没有证据支撑的最终答案（[arXiv 2608.12002](https://arxiv.org/html/2608.12002v1)）。

## 给自建 harness 的含义：先逐项核对这些假设

我没有看过读者的代码，下面不断言它做了或没做什么；每条都是一件值得去查的事和查它的依据。先把两家的契约并排放：

| 行为 | Claude Messages API | DeepSeek API |
|---|---|---|
| 强制工具调用 | `any` / `tool` 在 Fable 5.1、Mythos 5.1、Opus 5.5、Sonnet 5.5 上返回 400；`auto` / `none` 不变 | Chat Completions 上 thinking 模式不支持 `required` 和指定函数，返回 400；Anthropic 端点和 Responses API 是否同样受限，文档没写 |
| 关闭 thinking | Opus 5.5、Sonnet 5.5、Fable / Mythos 5.x 上 `disabled` 返回 400 | `thinking: {"type": "disabled"}` 或 `reasoning_effort: "none"` 可关 |
| 回传推理 | 工具调用轮内必须原样回传；5.1 / 5.5 模型上还绑定到未改动的前缀 | 带 `tools` 时每一轮的 `reasoning_content` 都要回传，否则 400 |
| 缓存 | 显式断点或 automatic caching；5 分钟 / 1 小时 TTL；写入 1.25 / 2 倍，读取 0.025–0.1 倍 | 自动前缀缓存，无断点、无写入费行；保留"几小时到几天"；命中价为未命中价的 2–3.3% |
| 并行工具调用 | 可用 `disable_parallel_tool_use` 关 | 三个端点都关不掉 |
| 随 200 返回的失败 | `refusal`、纯文本 `end_turn`、`model_context_window_exceeded` | `finish_reason` 为 `insufficient_system_resource` / `aborted`；另有空响应的个案报告 |
| 模型 id | 钉死的快照，退役前至少 60 天通知 | 同一 id 下换过权重；旧名静默别名到新模型 |
| 采样参数 | 4.7 及之后非默认值返回 400 | thinking 模式下接受但不生效 |

出处见第二、三节：[API release notes](https://platform.claude.com/docs/en/release-notes/overview)；[Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking)；[Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)；[Model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations)；[Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion)；[Thinking Mode guide](https://api-docs.deepseek.com/guides/thinking_mode)；[Context Caching guide](https://api-docs.deepseek.com/guides/kv_cache)。

### Claude 席位（规划与审查）要核对的

**核对每个 Claude 请求的 `tool_choice`，按模型分。** 如果有任何路径对 Fable 5.1、Mythos 5.1、Opus 5.5 或 Sonnet 5.5 发送 `any` 或 `tool`（例如为了不让一轮以散文结束，或为了拿结构化裁决），按 release notes 它会得到 400。文档给的替代是 `auto` 加 `strict: true` 或 structured outputs 保证参数合法，循环一侧自己处理纯文本的 `end_turn`（[API release notes](https://platform.claude.com/docs/en/release-notes/overview)；[Strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use)）。与此相连的一项：**核对循环怎样判定"这一轮结束等于任务结束"**。Opus 5.5 的文档明确说无人值守时会出现以文本结束的进度更新，建议用清单或检查模型来续跑。

**核对有没有任何代码路径改写已发送的历史。** 包括微压缩、裁剪旧工具结果、在较早的消息里重新渲染状态快照、恢复时换 system prompt。在 5.1 / 5.5 模型上这同时破坏缓存和 thinking 的有效性。先查账户创建日期在 2026-08-31 之前还是之后：之后的账户默认执行前缀检查，会直接 400；之前的账户目前是静默的，可以开 `thinking-binding-controls-2026-08-01` 并记录 `thinking_mismatch_allowed` 条目，量出自己每天改写多少次，再决定迁到服务端 compaction、context editing，还是整段历史替换（[Preserved thinking](https://platform.claude.com/docs/en/build-with-claude/thinking#preserved-thinking)）。如果客户端库在 `messages` 末尾追加一条空的 `role: "system"` 消息来携带 `output_config.effort`，那是文档记载的按消息改 effort 的形式；要核对断点放置逻辑有没有假设最后一条一定是 user 或 tool_result（[Effort](https://platform.claude.com/docs/en/build-with-claude/effort#change-effort-mid-conversation-beta)）。

**核对审查、审计、评委类 prompt 的措辞。** 搜一遍 system prompt、skill 和工具描述里有没有要求模型"写出推理过程"、填写 `reasoning` / `thinking` / `trace` 字段或 scratchpad 的地方：这些是文档列出的 `reasoning_extraction` 触发写法，拒答计费且没有 fallback。做机器学习相关研究的 harness 还要预期 `frontier_llm` 的误报。确认循环按 `stop_reason` 分支，确认监控把拒答单独计数（它是 200，错误率和 5xx 监控看不到），确认每条发请求的路径包括子代理各自有 fallback（[Refusals and fallback: common pitfalls](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback#common-pitfalls)）。

**核对缓存的三个假设。** 一是 TTL 的起点：寿命从请求开始算，一次生成两分钟的请求之后只剩约三分钟。把每个角色的请求间隔分布拉出来，对照指南的规则（约每 20 个间隔里有 1 个以上落在 5 分钟到 1 小时之间、且超过 1 小时的很少时用 1 小时 TTL）。二是命中率基线：中位数 84%，前 10% 为 94%，低于 80% 就查。三是未命中的归因：`diagnostics.previous_message_id` 能把"自己改了前缀"和"TTL 过期"分开，只在 Claude API 上、且每轮都发才有效（[Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence#pick-the-cache-duration)；[Cache diagnostics](https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics)）。

**核对几处会随迁移悄悄变化的默认值。** effort 是否显式设置（Opus 5.5 默认 `medium`）；按字符估 token 的阈值是否还按旧 tokenizer 标定（4.7 及之后约多 30%，可用 `count_tokens` 对同一请求在新旧模型上各数一次）；有没有哪里传了非默认的 `temperature` / `top_p`；模型 id 表里有没有 Sonnet 4.5（2026-11-30 退役）、Haiku 4.5 或 Opus 4.5（承诺的最早退役日分别是 2026-10-15 和 2026-11-24，尚无退役公告）；计费代码在涉及 compaction、fallback 或 advisor 的请求上读的是不是 `usage.iterations`（[Token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting)；[Model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations)）。如果也把 `claude -p` 当执行器：钉住 `--model`、`--bare` 与否和权限模式，读 `terminal_reason` 判断是否死于 API 错误，不要只读 `subtype`。

### DeepSeek 席位（生产）要核对的

**先确认 `deepseek-v4-pro` 背后是哪个模型**（第三节的四个办法），再核对哪些席位需要看图。文档里只有 `deepseek-flash` 支持图像；给 `deepseek-v4-pro` 发图时 API 的行为没有文档，公开证据指向失败或占位符，自信的错误回答这种可能性只能用有标准答案的探针排除。同时核对模型 id 表：`deepseek-v4-flash` 和 `deepseek-v4-flash-vision-exp` 是会静默返回 200 的别名，没有终止日期；`deepseek-flash` 是不带版本的 id，背后的权重可以换。

**核对 `reasoning_content` 在每一种转录操作后是否还在。** 压缩、裁剪、checkpoint 重放和会话恢复、把一段对话从别的 provider 切到 DeepSeek，以及子代理结果回传给父会话。DeepSeek 自己的 harness 在子代理通知和会话恢复这两处都修过 bug。带 `tools` 的请求里只丢掉部分轮次的推理，就是文档写明的 400 路径；丢掉或改动它还会改变前缀，连带丢缓存命中（[Thinking Mode guide](https://api-docs.deepseek.com/guides/thinking_mode)；[releases](https://github.com/deepseek-ai/deepseek-harness/releases)）。

**核对强制工具调用和 thinking 有没有同时出现。** 按 Chat Completions 参考页，thinking 开着时 `required` 和指定函数会 400。如果某些调用确实要强制一个工具，确认那些调用带了 `thinking: {"type": "disabled"}` 或 `reasoning_effort: "none"`；如果走的是 Anthropic 端点，文档没说 `any` / `tool` 在 thinking 下的行为，需要自己测一次。短的、非流式的旁路调用（分类器、裁决）同理：关掉 thinking 的实测是 31.8 秒对 2.7 秒。

**核对"既无文本也无工具调用"的一轮被记成什么。** 三份现场报告的共同外观是 HTTP 200 加空内容；再加上 `finish_reason` 的 `insufficient_system_resource` 和 `aborted`。把这类轮次记成"完成"的 harness 会把它们当作交付。如果 provider 层在发给 DeepSeek Anthropic 端点的消息列表末尾放了 `role: "system"` 消息，对照 new-api #5411 测一次返回是否为空。

**核对传输层和计费的几个假设。** 看门狗按"多久没收到字节"计时的话，keep-alive 会让它在长达 10 分钟的排队里一直不触发，按"多久没收到内容 token"才会。402 是账户级终止，应干净停下，不进重试循环；429 和 503 才是可重试的。缓存命中率按 `prompt_cache_hit_tokens / prompt_tokens` 记。`user_id` 会分隔缓存，给每个子代理不同的 `user_id` 会让它们无法共享公共前缀；按文档里的示例推断，共享一个新前缀的头两个并行子代理都不会命中。经 Anthropic 端点传真实的 Claude id 会被按前缀映射并计费，`is_error` 标记到不了模型，错误要写进结果文本。跨越工作日 01:00–04:00 或 06:00–10:00 UTC 的运行那几个小时付双倍价（[Rate Limit](https://api-docs.deepseek.com/quick_start/rate_limit)；[Anthropic API guide](https://api-docs.deepseek.com/guides/anthropic_api)）。

### 两边共同的：任务分派、脚手架的去留，和自己的测量

**核对任务分派是否顺着差距的形状。** 独立数据里 DeepSeek 在阅读、问答和短而明确的编辑上损失最小（约 5 分），在长时间自主的终端任务上损失最大（最多 53 分）。如果生产席位里有多小时、多步骤的自主执行，那是最值得单独量一次的地方；如果某个席位串行地卡着墙上时间，把 `low` effort 的 Sonnet 5.5 也放进对比：AA 的同分档上它贵 2 倍、快 6 倍。

**核对每条脚手架是为哪个模型写的。** Anthropic 的"删脚手架"证据全部来自 Claude 模型：为 Opus 4.8 写的 prompt 在 Opus 5 上每单贵 36% 而准确率不变；删掉 "verify twice" 让每单成本降了三分之一；删掉已退役的 thinking 设置、互相矛盾的规则和手写 scratchpad，各恢复了 7–11 分（[Optimizing for cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence#audit-prompts-against-the-current-model)）。这些结论适用于 Claude 席位，对 DeepSeek 席位什么也没说。弱模型一侧的文献支持保留结构（显式的计划步、类型化工具、托管的上下文）。两类证据都不是在这一对模型上做的，所以每次改 prompt 都按模型分开评测，是唯一能回答"这条该不该删"的办法，这也是 Anthropic 在复盘里对自己承诺的做法。

**核对多代理结构是否赢过了"单模型降 effort"这条基线。** Anthropic 的测量里 orchestrator 只在两种情形省钱，给出的决策顺序是先在当前模型上扫 effort，再给更强的模型单独在低 effort 下定价，多模型配置要赢过单模型的整条曲线。这是 Claude 模型上的结论；生产端是便宜得多的 DeepSeek 时算术不同，需要自己的数字。独立验证这一层的证据方向一致但缺少按模型强度分层的受控研究，保留它的理由目前来自自己的 trace。

## 结论

两家从相反的方向走到了同一个形状。Claude 用 400 和前缀绑定，DeepSeek 用 400 和自动前缀缓存，惩罚的是同样三个习惯：强制工具调用，改写已发送的历史，以及从"这一轮没有工具调用"推断任务完成。只追加转录、原样回传推理、从带类型的字段读终态的循环同时兼容两边；依赖这三个习惯的循环会在两家同时出问题，而且其中几种失败是静默的（老账户上未被执行的前缀检查、返回 200 的空轮次、返回 200 的别名）。两家自己的 harness 也在往同一处收：工具面和固定 prompt 变小（DSH 用 Minimal 跑分，Claude Code 删掉 80% 的 system prompt），编排从模型的上下文移进确定性的脚本和类型化的事件。

对运营混合 harness 的人，这轮调研最大的空白就是最想要的那个数：没有任何公开实验把当前这一对模型（Opus 5.5 或 Sonnet 5.5 对 V4 Pro 0813 或 V4.1-Flash）放在同一个 harness 里比，也没有任何实验把同一套脚手架消融施加在两家模型上。"哪个模型在服务这个 id"在 DeepSeek 一侧已经是需要定期用探针重测的量，写在配置里的值不够。在这两件事上，自己的运行记录比公开文献更接近答案，值得按"模型 + harness + effort + 日期"四个字段记下每一个数。
