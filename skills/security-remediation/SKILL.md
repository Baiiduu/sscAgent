---
name: security-remediation
description: 对已确认或高优先级安全问题执行项目入口 PoC、复现、修复和验证闭环，输出 PoC、复现脚本、工具验证结果、补丁和验证报告。
---

# 修复复现闭环阶段

当安全问题已经经过可达性分析，并被判断为 `affected`、高优先级，或用户明确要求修复复现时，使用本技能。

本阶段对应真实安全工程闭环：

```text
理解漏洞 -> 编写项目入口 PoC -> 调用 poc_evaluate 验证 -> 修复 -> 再次验证 -> 总结
```

## Finding capture

本阶段必须继续使用 discovery/triage 阶段已经创建的 finding，并使用一致的 stableKey。项目级输出仍然必须保留：`poc.md`、`repro-script.*`、`poc-evaluation-result.json`、`repair-summary.md`、`validation-report.md`、`patch.diff` 不可由 finding capture 替代。

对每个进入修复复现闭环的 finding：

1. 生成 PoC 或 repro script 后，调用 `finding_capture action=append_event` 追加 `poc_generated`。
2. 调用 `poc_evaluate` 后，必须把工具返回的状态、oracle、entrypointEvidence、resultPath 和关键原因追加为 `poc_evaluated`。
3. 如果无法安全生成或执行 PoC，追加 `blocked`，说明阻塞条件。
4. 生成修复或 patch 后，追加 `fix_generated`，引用 patch artifact。
5. 修复后验证完成后，追加 `fix_validated`，说明验证命令、结果和剩余风险。

`poc_evaluated.data.status` 应直接使用 `poc_evaluate` 返回状态：`verified`、`not_triggered`、`invalid`、`inconclusive` 或 `unsafe_blocked`。不要把 agent 自己的判断写成 verified。

## 进入条件

必须满足至少一项：

- 当前 GitHub Actions `execution_mode=remediation_reproduction`。
- 当前 GitHub Actions `execution_mode=benchmark`，且 benchmark 任务协议要求修复、复现或验证。
- 用户明确要求修复、复现或验证。
- 上游 `security-triage` 明确建议进入修复复现阶段，且当前任务上下文已授权。

如果没有明确授权，不要修改文件，不要安装依赖，不要运行测试、构建或服务。

## 输入

优先读取：

```text
./repos/<repo-name>/
./artifacts/<repo-name>/triage-report.json
./artifacts/<repo-name>/risk-ranking.md
./artifacts/<repo-name>/osv-query-result.json
./artifacts/<repo-name>/dependency-discovery.json
```

如果是 SWC-bench、SEC-bench 或类似安全任务，还应读取：

- 任务描述
- bug report 或 sanitizer report
- repro script
- base_commit 或目标 commit
- build、test 或 validation script
- benchmark 要求的输出格式

## PoC 要求

生成 `poc.md` 或 `repro-script.*` 后，应向对应 finding 追加 `poc_generated` 事件，记录 PoC 类型、入口、触发前提、artifact 路径和是否仍缺少环境准备。

本阶段必须优先生成“教学型 PoC”，帮助用户理解漏洞为什么成立，而不是生成攻击型 exploit。

PoC 必须优先基于目标项目的真实入口触发。真实入口包括但不限于：

- HTTP API、路由、控制器或本地服务端口
- CLI 参数、命令行子命令或项目脚本
- 配置文件、上传文件、导入文件或解析入口
- 插件入口、任务队列、hook、测试入口或框架生命周期入口

对依赖漏洞，PoC 不应只是直接调用依赖库的 vulnerable API。它必须尽量证明：

```text
项目真实入口 -> 项目代码路径 -> 受影响依赖 API 或危险配置 -> 预期漏洞现象
```

只有在无法安全启动项目、无法安装依赖、入口条件缺失或环境受限时，才允许退化为最小本地脚本。退化时必须在 `poc.md` 和 `validation-report.md` 中说明原因，并把结论标记为 `inconclusive` 或 `likely_affected`，不要声称已经真实验证。

默认输出：

```text
./artifacts/<repo-name>/poc.md
```

在安全、低风险、可本地运行时，还应输出：

```text
./artifacts/<repo-name>/repro-script.*
```

`poc.md` 应包含：

- 问题 ID 或漏洞编号
- 漏洞类型，例如路径穿越、SSRF、命令注入、依赖漏洞、认证绕过等
- 触发前提
- 项目真实入口
- 受影响代码路径
- 数据流：输入点 -> 传播路径 -> 危险 sink
- 最小触发样例
- 预期现象
- `poc_evaluate` 的验证结果摘要
- 修复后现象
- 安全边界：仅用于本地测试、学习和授权环境

PoC 边界：

- 优先使用本地服务、项目 CLI、项目测试入口、curl 到本地服务或最小脚本。
- 不要默认生成可直接攻击第三方目标的武器化 exploit。
- 不要包含真实 token、密钥、账号、内网地址或第三方目标。
- 如果 PoC 可能造成破坏，应改写为解释型 PoC，并说明不能安全执行的原因。

## poc_evaluate 工具

每次调用 `poc_evaluate` 后，都必须向对应 finding 追加 `poc_evaluated` 事件。事件中的 `data.status` 必须来自工具返回，`summary` 应说明 oracle 是否命中、是否通过真实项目入口触发、失败或阻塞原因。

生成 PoC 或 repro script 后，必须调用 `poc_evaluate` 工具进行验证，除非存在明确阻塞原因。

`poc_evaluate` 只负责执行 PoC 命令并检查 oracle。它不会自动判断漏洞类型，也不会自动启动项目。调用前应先完成必要准备，例如安装依赖、启动本地服务、确认端口 ready。

推荐调用格式：

```json
{
  "repoDir": "./repos/<repo-name>",
  "pocCommand": "node ./artifacts/<repo-name>/repro-script.js",
  "timeoutSeconds": 30,
  "entrypointEvidence": {
    "type": "http",
    "description": "PoC 通过项目本地服务的 POST /api/parse 入口触发"
  },
  "oracle": {
    "type": "stdout_contains",
    "value": "VULNERABLE_CONFIRMED"
  }
}
```

可使用的 oracle：

- `exit_code`：PoC 退出码等于指定值。
- `stdout_contains`：stdout 包含指定 marker。
- `stderr_contains`：stderr 包含指定 marker。
- `output_contains`：stdout 或 stderr 包含指定 marker。

工具返回状态含义：

- `verified`：PoC 通过项目真实入口触发，并命中 oracle。
- `not_triggered`：PoC 执行完成，但没有命中 oracle。
- `invalid`：参数、路径或 PoC 配置不合法。
- `inconclusive`：超时、环境失败、服务未启动或依赖失败，无法判断。
- `unsafe_blocked`：命令触发安全边界，被工具拦截。

如果 `poc_evaluate` 返回 `verified`，可以把该问题标记为真实影响已验证，并允许进入后续修复。

如果返回 `not_triggered`、`invalid`、`inconclusive` 或 `unsafe_blocked`，不要直接断言漏洞不存在，也不要对该问题进行修复。应根据工具输出分析原因，并决定是否调整 PoC、补充环境步骤或降低结论置信度。

修复门槛：

- 只有 `poc_evaluate.status=verified` 的问题可以进入修复。
- 未经过 PoC 验证的问题只能记录为候选风险、未验证风险或待复现问题。
- PoC 验证失败、环境不确定或工具拦截的问题，暂时不修改目标代码，避免因为误判引入无关修复。

`poc_evaluate` 默认会写入：

```text
./artifacts/<repo-name>/poc-evaluation-result.json
```

## 复现

运行命令前必须说明：

- 将执行的命令
- 工作目录
- 是否会下载依赖
- 是否会启动服务或占用端口
- 可能耗时

复现优先级：

1. benchmark 或任务提供的 repro script。
2. 项目已有相关测试。
3. 基于项目真实入口的最小自建教学型 PoC。
4. 静态证据无法安全复现时，说明原因并继续做最小修复分析。

## 修复原则

生成修复或 patch 后，应向对应 finding 追加 `fix_generated` 事件，记录修改文件、修复思路和 `patch.diff` 路径。

- 只修复已经通过 `poc_evaluate` 验证为 `verified` 的问题。
- 做最小必要修改。
- 只修改与确认问题直接相关的文件。
- 优先修复根因，而不是只让测试通过。
- 对依赖漏洞，优先选择有证据支持的安全版本。
- 对源码漏洞，优先增加边界检查、输入校验、安全 API、权限检查或正确错误处理。
- 不要修改无关格式、注释、业务逻辑、CI/CD 或部署文件。
- 不要使用危险参数绕过依赖冲突，例如 `--force`、`--legacy-peer-deps`，除非用户明确要求且报告中说明风险。

## 验证

修复后验证完成后，应向对应 finding 追加 `fix_validated` 事件。若验证无法完成，应追加 `blocked`，说明环境、凭证、依赖或安全边界等阻塞原因。

验证优先级：

1. 修复前 PoC 能命中 `poc_evaluate` oracle。
2. 修复后同一 PoC 不再命中漏洞 oracle，或命中安全结果 oracle。
3. 项目已有相关测试通过。
4. 最小构建或类型检查通过。
5. 不引入明显回归。

如果验证失败，应根据错误做最小修正；如果失败来自外部服务、缺失凭证、环境限制或安全边界，应停止并说明阻塞条件。

## 输出

尽量写出：

```text
./artifacts/<repo-name>/poc.md
./artifacts/<repo-name>/repro-script.*
./artifacts/<repo-name>/poc-evaluation-result.json
./artifacts/<repo-name>/repair-summary.md
./artifacts/<repo-name>/validation-report.md
./artifacts/<repo-name>/patch.diff
```

`repair-summary.md` 应包含：

- 修复的问题 ID
- 修改文件
- 修改原因
- 修复思路
- 未处理项和原因

`validation-report.md` 应包含：

- 执行命令
- 工作目录
- 关键日志摘要
- `poc_evaluate` 返回状态
- PoC 是否通过项目真实入口触发
- PoC 是否复现成功
- PoC 在修复后是否失效
- 是否修复成功
- 剩余风险

`patch.diff` 可以通过 `git diff` 生成，保留与修复直接相关的 diff。

## 边界

- 没有授权时不要修改文件。
- 没有授权时不要运行测试、构建、安装依赖或启动服务。
- 不要提交代码或推送远程仓库。
- 不要输出武器化 exploit、真实凭证、真实攻击目标或可直接滥用的攻击流程。
- 不要把完整大型日志、完整 lockfile 或完整依赖安装输出粘贴到最终报告中。
