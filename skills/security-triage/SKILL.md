---
name: security-triage
description: 对安全发现阶段产生的候选问题做可达性、影响和优先级判断，区分真实风险、低风险、误报和需要人工确认的问题。
---

# 可达性分析与影响判断阶段

当已经有依赖漏洞候选或源码漏洞候选，需要判断其是否真实影响当前项目时，使用本技能。

本阶段负责回答“这个问题是否值得进入修复复现闭环”。它不直接修复代码，也不做完整验证。

## Finding capture

本阶段必须继续使用 discovery 阶段已经创建的 finding。项目级输出仍然必须保留：`triage-report.json` 和 `risk-ranking.md` 不可省略；finding capture 只是把同一分析过程按单个漏洞 case 细粒度记录。

对每个进入 triage 的候选问题：

1. 使用与 discovery 阶段一致的 stableKey。
2. 调用 `finding_capture action=append_event` 追加 triage 事件。
3. 不要用 finding capture 替代项目级 artifact。

triage 阶段常用事件类型：

- `reachability_analysis`：记录 direct/transitive、runtime/dev、import/require、入口、调用链、affected API、可控输入、reachable 结论等。
- `triage_note`：记录优先级、证据缺口、不确定性、降级原因、not affected/false positive 判断。
- `blocked`：记录因为缺少依赖、环境、源码、漏洞详情、权限或安全边界导致无法继续判断。

`data.status` 可使用 `affected`、`not_affected`、`low_priority`、`under_investigation`、`false_positive`。若判断可达，建议同时设置 `data.reachable=true`。若证据不足，不要写成 affected，应记录为 `under_investigation` 或 `blocked`。

## 目标

对候选问题做分流：

```text
affected
not_affected
low_priority
under_investigation
false_positive
```

并给出优先级：

```text
critical
high
medium
low
unknown
```

## 输入

优先读取：

```text
./repos/<repo-name>/
./artifacts/<repo-name>/dependency-discovery.json
./artifacts/<repo-name>/security-candidates.json
./artifacts/<repo-name>/osv-query-result.json
```

如果缺少候选发现产物，应先回到 `security-discovery`。

## 依赖漏洞可达性分析

对每个依赖漏洞候选判断：

- 该依赖是 direct、transitive、dev/test/build-only 还是 runtime。
- 项目源码是否 import、require 或实际使用该依赖。
- 是否使用了漏洞描述中的受影响 API、函数、类、配置或协议。
- 是否处于运行时入口、路由、认证、文件处理、网络请求、数据库访问、反序列化等关键路径。
- 是否存在可控输入能到达该依赖或 API。
- 是否有配置、环境或版本条件使漏洞不可触发。

不要仅凭 OSV 命中就判定 `affected`。

对每个依赖漏洞候选，都应追加 `reachability_analysis` 或 `triage_note` 事件，说明该依赖是否处于运行时路径、项目是否实际使用、是否触达受影响 API、是否存在可控输入，以及当前是否建议进入后续复现。

## 源码漏洞影响判断

对源码候选问题判断：

- 输入是否可控。
- 是否有完整或部分调用链。
- 是否存在过滤、校验、编码、权限检查或沙箱隔离。
- 漏洞是否在真实运行入口上。
- 是否需要构造 PoC 才能确认。
- 是否存在已有测试、repro、sanitizer report 或 bug report 支持。

如果证据不足，应标记为 `under_investigation`，并说明缺少哪些证据。

对每个源码漏洞候选，都应追加 `reachability_analysis` 或 `triage_note` 事件，说明输入可控性、入口、调用链、过滤/权限检查、sink 和剩余不确定性。

## 输出

必须写出：

```text
./artifacts/<repo-name>/triage-report.json
./artifacts/<repo-name>/risk-ranking.md
```

`triage-report.json` 建议包含：

- `repositoryPath`
- `findings`
- 每个问题的 `id`、`kind`、`status`、`priority`、`reason`、`evidence`
- `recommendedNextStage`
- `summary`

`risk-ranking.md` 应用中文说明：

- 最值得优先处理的问题
- 为什么它们真实影响项目
- 哪些只是低风险或理论风险
- 哪些需要人工确认
- 是否建议进入 `security-remediation`

## 边界

- 不要修改目标项目。
- 不要运行破坏性命令。
- 不要扩大证据之外的结论。
- 不要因为“版本有漏洞”就直接要求修复；必须说明是否可能真实使用。
