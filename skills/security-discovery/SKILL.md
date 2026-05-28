---
name: security-discovery
description: 从开源项目仓库中执行上游分析，发现依赖已知漏洞和源码级潜在漏洞候选，并写出候选发现 artifact。
---

# 上游分析与候选发现阶段

当任务需要从一个开源项目中主动发现安全问题候选项时，使用本技能。

本阶段只负责“发现候选问题”，不负责判断最终影响、不负责修复、不负责验证。发现结果后应交给 `security-triage` 做可达性和影响判断。

## Finding capture

本阶段必须把项目级发现细粒度记录为单个 finding。

当发现一个可独立追踪的漏洞候选时，必须调用 `finding_capture`：

1. 先用 `action=open` 创建 finding。
2. 再用 `action=append_event` 追加发现证据。

依赖漏洞 stableKey 建议格式：

```text
dependency:<ecosystem>:<package-name>:<cve-ghsa-or-osv-id>
```

源码漏洞 stableKey 建议格式：

```text
source:<cwe-or-kind>:<file-or-entrypoint>:<short-name>
```

发现阶段常用事件类型：

- `dependency_match`：项目依赖、版本或 PURL 命中漏洞候选。
- `vulnerability_lookup`：OSV、GHSA、CVE 或后端查询返回的漏洞详情。
- `source_evidence`：源码中发现潜在漏洞模式、入口、sink 或敏感路径。

`summary` 必须简短说明这条事件对单个 finding 的意义。`data` 中可以放依赖版本、PURL、漏洞 ID、文件路径、入口、sink、查询来源等结构化信息。若已写出 artifact，应在 `artifactPath` 中引用对应路径。

不要等最终报告才整理 findings；发现候选时就记录，后续分析阶段继续往同一个 stableKey 追加事件。

## 目标

发现两类候选问题：

1. 依赖漏洞候选
   - 读取 manifest 和 lockfile。
   - 提取依赖、版本、生态和 PURL。
   - 使用已知漏洞数据源或工具查询依赖漏洞。

2. 源码漏洞候选
   - 阅读源码结构、入口、路由、配置和安全敏感路径。
   - 发现潜在漏洞模式，例如路径穿越、命令注入、SQL 注入、SSRF、反序列化、XSS、认证绕过、越权、资源泄露等。

## 输入

优先读取：

```text
./repos/<repo-name>/
```

如果仓库尚未克隆，先使用 `git-clone` 技能。

## 依赖发现

优先读取：

- JavaScript/TypeScript：`package.json`、`package-lock.json`、`pnpm-lock.yaml`、`yarn.lock`、`bun.lock`
- Python：`requirements.txt`、`pyproject.toml`、`poetry.lock`、`Pipfile.lock`
- Go：`go.mod`、`go.sum`
- Java/Kotlin：`pom.xml`、`build.gradle`、`build.gradle.kts`
- 其他生态的常见 manifest 和 lockfile

规则：

- 优先直接运行时依赖。
- 优先 lockfile 中的精确版本。
- 无法可靠确定版本时，不要构造 PURL。
- dev/test/build-only 依赖应标注为较低优先级，除非用户明确要求分析开发依赖。
- 依赖漏洞查询结果应保留来源和 artifact 路径。
- 每个可独立追踪的依赖漏洞候选都应调用 `finding_capture action=open`，并至少追加一条 `dependency_match` 事件；如果执行了 OSV/GHSA/CVE 查询，还应追加 `vulnerability_lookup` 事件。

必须写出：

```text
./artifacts/<repo-name>/dependency-discovery.json
```

即使没有找到可查询依赖，也要写出空结果和原因。

## 源码漏洞候选发现

优先阅读：

- README、启动入口、路由文件、控制器、服务层
- 配置文件、环境变量示例、Docker/compose 文件
- 认证、鉴权、上传、文件读取、模板渲染、命令执行、网络请求、数据库访问、序列化/反序列化相关代码

发现源码候选问题时，必须给出证据：

- 文件路径
- 行号或可定位片段
- 触发入口或调用链线索
- 可控输入来源
- 可能的漏洞类型或 CWE
- 不确定性说明

每个可独立追踪的源码漏洞候选都应调用 `finding_capture action=open`，并追加 `source_evidence` 事件。若只有弱线索，也应在 `data.confidence` 或 `summary` 中说明不确定性，不要把源码候选直接当作确认漏洞。

## 输出

尽量写出：

```text
./artifacts/<repo-name>/dependency-discovery.json
./artifacts/<repo-name>/security-candidates.json
```

`security-candidates.json` 建议包含：

- `repositoryPath`
- `candidateFindings`
- 每个候选的 `id`、`kind`、`source`、`evidence`、`confidence`
- `notes`

## 边界

- 不要修改目标项目。
- 不要运行测试、构建或服务。
- 不要把候选问题直接当作确认漏洞。
- 不要编造依赖版本、漏洞编号或源码证据。
- 不要因为依赖存在漏洞就直接断言项目受影响；影响判断交给 `security-triage`。
