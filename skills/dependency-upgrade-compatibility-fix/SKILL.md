---
name: dependency-upgrade-candidate-check
description: 通过静态代码、manifest、lockfile 和可选 artifact 证据筛选最多 20 个关键依赖 PURL，并调用工具查询可升级状态
---

# 依赖升级候选筛选与版本查询

当用户要求判断哪些依赖应优先升级、检查依赖是否有新版本，或为后续依赖修复做准备时，使用本技能。

本技能只负责“筛选候选依赖并查询升级信息”。不要在本技能中直接修改项目文件、升级 lockfile、安装依赖、运行构建或测试。

## 输入上下文

优先从当前会话工作区读取证据：

```text
./repos/<repo-name>/
./artifacts/<repo-name>/osv-query-result.json
./artifacts/<repo-name>/dependency-update-check.json
```

可选读取已有 SBOM，但不要要求生成 SBOM，也不要调用 `sbom_generate`：

```text
./artifacts/<repo-name>/sbom-summary.json
./artifacts/<repo-name>/sbom.cdx.json
```

如果用户已经给出仓库路径或 artifact 路径，优先使用用户提供的路径。否则根据当前会话中的 `./repos/` 和 `./artifacts/` 推断。

## 核心原则

不要把所有依赖都交给 `dependency_update_check`。

必须先由 agent 基于静态证据筛选最多 20 个关键 PURL。筛选依据包括：

- 直接依赖优先于传递依赖。
- 运行时依赖优先于 dev/test/build-only 依赖。
- 源码中真实出现 `import`、`require`、调用、配置引用或运行入口引用的依赖优先。
- Web 框架、路由、中间件、模板引擎、文件上传、压缩解压、数据库驱动、认证、session、HTTP 客户端、解析器、反序列化相关依赖优先。
- 已知历史高风险包、版本明显过时、或位于用户请求关注路径中的依赖优先。
- 如果已有漏洞结果或威胁情报结果，漏洞严重且可达的依赖优先。

## 执行流程

1. 识别项目生态和包管理器。
2. 读取 manifest 和 lockfile，例如 `package.json`、`package-lock.json`、`pnpm-lock.yaml`、`requirements.txt`、`pyproject.toml`、`pom.xml`、`go.mod`。
3. 如已有 artifact 或 SBOM，可读取摘要作为补充证据，但不要依赖其存在。
4. 搜索源码中对候选依赖的真实引用，只读源码，不执行源码。
5. 构造最多 20 个 PURL，优先使用 lockfile 中的精确版本。
6. 在调用 `dependency_update_check` 前，必须把依赖发现和候选筛选证据写入：

   ```text
   ./artifacts/<repo-name>/dependency-discovery.json
   ```

7. 对每个 PURL 写清选择理由和风险信号。
8. 调用 `dependency_update_check` 工具。
9. 报告升级检查摘要、artifact 路径、未能查询的 PURL，以及后续建议。

`dependency-discovery.json` 至少应包含：

- `repositoryPath`
- `artifactDir`
- `ecosystems`
- `evidenceFiles`
- `selectedPurls`
- `skipped`
- `notes`

`selectedPurls` 中每一项应包含 `purl`、`name`、`version`、`ecosystem`、`direct`、`dependencyType`、`versionSource`、`sourceEvidence` 和 `selectionReason`。

## 选择理由要求

每个候选项至少说明：

- 为什么它重要。
- 它是否是直接依赖。
- 它是否在源码中被真实使用。
- 它和安全风险或业务关键路径的关系。
- 版本信息来自哪个文件或 artifact。

如果只能从 artifact 或 SBOM 看到依赖，但没有找到源码引用，应降低优先级，并说明证据较弱。

如果确认是测试或开发依赖，应降低优先级，除非用户明确要求检查开发依赖。

## 输出要求

最终回答应包含：

- 实际检查的 PURL 数量。
- 有可升级版本的数量。
- `dependency-update-check.json` 的 artifact 路径。
- 最重要的几个升级候选及其选择原因。
- 查询失败或未命中的 PURL。

不要把完整 artifact 内容粘贴到对话中，除非用户明确要求。

## 边界

本技能不负责：

- 直接修改 manifest 或 lockfile。
- 运行 `npm install`、`mvn test`、`pip install` 等依赖安装或构建命令。
- 启动后端服务、数据库、消息队列、前端 dev server 或项目运行入口。
- 自动选择最终修复版本。
- 处理兼容性补丁。

这些动作应交给后续的依赖升级应用和验证技能。
