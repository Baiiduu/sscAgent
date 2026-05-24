---
name: security-remediation
description: 对已确认或高优先级安全问题执行教学型 PoC、复现、修复和验证闭环，输出 PoC、补丁、修复摘要和验证报告。
---

# 修复复现闭环阶段

当安全问题已经经过可达性分析，并被判断为 `affected`、高优先级，或用户明确要求修复复现时，使用本技能。

本阶段对应真实安全工程闭环：

```text
理解漏洞 -> 编写教学型 PoC -> 复现 -> 修复 -> 验证 -> 总结
```

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

## PoC 与复现材料

本阶段必须优先生成“教学型 PoC”，帮助用户理解漏洞为什么成立，而不是生成攻击型 exploit。

默认输出：

```text
./artifacts/<repo-name>/poc.md
```

在安全、低风险、可本地运行时，可以额外输出：

```text
./artifacts/<repo-name>/repro-script.*
```

`poc.md` 应包含：

- 问题 ID 或漏洞编号
- 漏洞类型，例如路径穿越、SSRF、命令注入、依赖漏洞、认证绕过等
- 触发前提
- 受影响代码路径
- 数据流：输入点 -> 传播路径 -> 危险 sink
- 最小触发样例
- 预期现象
- 修复后现象
- 安全边界：仅用于本地测试、学习和授权环境

PoC 边界：

- 优先使用本地最小复现、单元测试、curl 到本地服务或最小脚本。
- 不要默认生成可直接攻击第三方目标的武器化 exploit。
- 不要包含真实 token、密钥、账号、内网地址或第三方目标。
- 如果 PoC 可能造成破坏，应改写为解释型 PoC，并说明不能安全执行的原因。
- 对依赖漏洞，PoC 应尽量说明“项目如何调用到受影响 API”，而不是只复述 CVE 描述。

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
3. 最小自建教学型 PoC。
4. 静态证据无法安全复现时，说明原因并继续做最小修复分析。

## 修复原则

- 做最小必要修改。
- 只修改与确认问题直接相关的文件。
- 优先修复根因，而不是只让测试通过。
- 对依赖漏洞，优先选择有证据支持的安全版本。
- 对源码漏洞，优先增加边界检查、输入校验、安全 API、权限检查或正确错误处理。
- 不要修改无关格式、注释、业务逻辑、CI/CD 或部署文件。
- 不要使用危险参数绕过依赖冲突，例如 `--force`、`--legacy-peer-deps`，除非用户明确要求且报告中说明风险。

## 验证

验证优先级：

1. PoC 或 repro 不再触发漏洞。
2. 项目已有相关测试通过。
3. 最小构建或类型检查通过。
4. 不引入明显回归。

如果验证失败，应根据错误做最小修正；如果失败来自外部服务、缺失凭证、环境限制，应停止并说明阻塞条件。

## 输出

尽量写出：

```text
./artifacts/<repo-name>/poc.md
./artifacts/<repo-name>/repro-script.*
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
- 结果
- 关键日志摘要
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
