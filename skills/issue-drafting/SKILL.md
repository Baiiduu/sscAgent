---
name: issue-drafting
description: 为已经通过 PoC 验证的 finding 生成可提交给开源项目 maintainer 的 GitHub issue 草稿，要求只基于给定事实、包含复现信息、影响说明和修复建议。
---

# Verified Finding Issue Drafting

当任务要求为真实开源项目生成 GitHub issue 草稿，且当前分析任务已经产生 verified finding 时，使用本技能。

本技能通常在一次仓库分析的末尾使用，而不是作为独立后处理扫描器使用。它利用当前 agent 已经完成的依赖发现、源码阅读、可达性分析、PoC 生成、`poc_evaluate` 验证和修复建议上下文，撰写可供人工 review 后提交的 issue 草稿。

本技能只负责撰写 issue 草稿，不负责重新判断漏洞是否成立，不负责提交 issue，不负责修改目标仓库。

## 输入边界

只为已经通过工具验证的 finding 写 issue。进入本技能前，必须确认：

```text
poc_evaluated.data.status = verified
```

如果输入没有明确的 verified PoC 证据，不要写成 confirmed issue。应要求补充 verified context，或生成“无法生成 verified issue”的说明。

不要为以下 finding 生成 issue 草稿：

```text
likely_impact
needs_evidence
blocked
not_affected
inconclusive
not_triggered
unsafe_blocked
```

这些 finding 可以保留在项目级报告和 Finding Console 中，但不应自动生成给上游项目的 issue。

## 输出路径

每个 verified finding 应生成一个 Markdown 文件：

```text
./artifacts/<repo-name>/issue-drafts/<finding-stable-key>.md
```

如果同一次分析有多个 verified finding，应分别生成多个 issue draft，不要把多个独立漏洞混在同一个 issue 中。

`<finding-stable-key>` 应做文件名安全化处理，但 issue 正文中仍应保留原始 stableKey 或可读 identifier，方便追踪。

项目级 artifacts 仍然必须保留。issue draft 是额外产物，不替代：

```text
dependency-discovery.json
security-candidates.json
triage-report.json
risk-ranking.md
upgrade-plan.md
poc.md
poc-evaluation-result.json
validation-report.md
patch.diff
```

## 核心原则

- 只使用输入 context 中出现的事实。
- 不要编造 CVE、GHSA、OSV、版本、包名、文件路径、入口、命令、输出、影响或修复。
- 不要把 agent 内部推理、原始事件 JSON 或 artifact 路径当作主要内容直接倾倒给 maintainer。
- issue 必须自包含；不要假设 maintainer 能访问本项目的 `.agent-data`、SQLite、artifact 或 Finding Console。
- 不要让 maintainer 去查看本项目 artifact。必要证据、PoC、复现步骤和验证结果应写入 issue 正文。
- 语气专业、克制、工程化，不夸大影响。
- 明确区分已验证事实、推断影响和剩余不确定性。
- 不要说“AI 发现”或“agent 认为”。可以说“local analysis indicates”或“the local PoC verification returned verified”。

## PoC 和复现内容

verified finding 的 issue 应尽量包含可本地复现的信息：

- 项目入口或触发路径
- 运行命令
- PoC 脚本或最小输入
- expected behavior
- actual behavior
- oracle 或关键输出
- `poc_evaluate` 的 verified 结果摘要

优先使用当前任务中已经生成或读取过的信息。不要因为准备 issue 草稿而重新扩大分析范围；如果缺少某个细节，应如实说明缺失，而不是编造。

可以包含 PoC 脚本，但必须满足：

- 面向本项目本地环境。
- 不攻击第三方目标。
- 不包含真实 token、密钥、账号、cookie 或私有地址。
- 不包含批量扫描、自动化攻击第三方、持久化破坏或数据 exfiltration 逻辑。
- 不包含破坏性命令，例如强制递归删除、清理磁盘、破坏系统配置等。

如果输入中的 PoC 脚本过长、依赖不清楚或存在披露风险，应说明需要人工 review，不要擅自简化成看似可运行的脚本。

## 必须输出的结构

生成的 Markdown issue 草稿必须包含以下章节：

```markdown
# <concise issue title>

## Summary

## Affected component

## Verified reproduction

## Expected behavior

## Actual behavior

## Impact

## Reachability evidence

## Suggested remediation

## Environment / notes
```

如果输入包含 patch 或修复验证信息，可以额外包含：

```markdown
## Possible fix

## Validation
```

## 章节要求

### Summary

用 2-4 句话说明问题核心：

- 受影响对象是什么
- 为什么它和当前项目有关
- 已经通过本地 PoC 验证

### Affected component

列出能定位问题的信息，例如：

- package / version / PURL
- vulnerability identifier
- source file / function / route / CLI entry
- affected API / sink

未知字段不要编造，直接省略或写 “not provided in the verified context”。

### Verified reproduction

给出 maintainer 能按步骤理解的本地复现方式。

优先使用输入中的：

1. repro script
2. `poc.md` 的最小触发样例
3. `poc_evaluate.pocCommand`
4. verified event 中的 entrypoint/oracle/summary

如果有脚本，使用代码块展示。代码块必须标注语言。

### Expected behavior / Actual behavior

Expected behavior 写安全预期，例如应该拒绝、转义、校验、抛出安全错误或不触发危险 sink。

Actual behavior 写 verified PoC 观察到的现象，例如 oracle 命中、特定输出、异常、危险行为或验证 marker。

### Impact

只根据 context 说明影响。不要夸大为 RCE、数据泄露、认证绕过等，除非 context 明确支持。

如果影响范围取决于配置、入口或部署方式，应写清楚条件。

### Reachability evidence

把 finding events 转成人类可读说明。优先包含：

- dependency/source evidence
- runtime usage
- entrypoint
- project call path
- affected API / sink
- controllable input

不要直接粘贴大段 JSON。

### Suggested remediation

根据 context 给出修复方向：

- 升级到安全版本
- 输入校验
- 使用安全 API
- 限制危险配置
- 添加回归测试

如果 context 没有足够修复信息，应给出保守建议，不要编造具体版本或 patch。

## 输出风格

- Markdown 清晰、简洁。
- 优先短段落和项目符号。
- 复现步骤要具体。
- 不要加入寒暄、营销语或无关背景。
- 不要附加完整大型日志、完整 lockfile 或无关源码。

## 最终检查

生成前自查：

- 是否只为 verified finding 写作？
- 是否包含复现信息？
- 是否包含 expected/actual？
- 是否说明了影响和可达性？
- 是否把必要证据写入 issue 正文，而不是只引用本地 artifact？
- 是否避免编造？
- 是否避免泄露真实 secret 或第三方目标？
