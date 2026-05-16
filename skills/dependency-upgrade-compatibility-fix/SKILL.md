---
name: dependency-upgrade-candidate-check
description: 仅通过静态代码和 SBOM 证据筛选最多 20 个关键依赖 PURL，并调用工具查询可升级状态
---

# 依赖升级候选筛选与版本查询

当用户要求判断哪些依赖应该优先升级、检查依赖是否有新版本、或为后续依赖修复做准备时，使用本技能。

本技能只负责“筛选候选依赖并查询升级信息”。不要在本技能中直接修改项目文件、升级 lockfile、安装依赖或运行构建验证。

本次流程只允许静态代码检查和已有 SBOM/产物分析。不要安装依赖、不要构建项目、不要运行测试、不要启动服务、不要访问项目运行入口。

## 输入上下文

优先从当前会话工作区读取证据。常见路径如下：

```text
./repos/<repo-name>/
./artifacts/<repo-name>/sbom-summary.json
./artifacts/<repo-name>/sbom.cdx.json
```

如果用户已经给出仓库路径或 artifact 路径，优先使用用户提供的路径。否则根据当前会话中的 `./repos/` 和 `./artifacts/` 推断。

## 核心原则

不要把 SBOM 中所有依赖都交给 `dependency_update_check`。

必须先由 agent 基于静态证据筛选最多 20 个最主要的 PURL。筛选依据包括：

- 直接依赖优先于间接依赖。
- 运行时依赖优先于 dev/test/build-only 依赖。
- 源码中真实出现 `import`、`require`、调用、配置引用或运行入口引用的依赖优先。
- Web 框架、路由、中间件、模板引擎、文件上传、压缩解压、数据库驱动、认证、session、HTTP 客户端、解析器、反序列化相关依赖优先。
- 已知历史高风险包、版本明显过旧、或位于用户请求关注路径中的依赖优先。
- 如果已有漏洞结果或威胁情报结果，漏洞严重度高且可达的依赖优先。

## 执行流程

1. 读取 `sbom-summary.json`，了解 SBOM 路径、直接依赖数量和 direct dependencies。
2. 按需读取 `sbom.cdx.json` 中的 `metadata`、`components`、`dependencies`。不要为了回答而复述完整 SBOM。
3. 读取仓库中的依赖清单，例如 `package.json`、`pom.xml`、`requirements.txt`、`go.mod` 等。
4. 搜索源码中对候选依赖的真实引用，例如 JavaScript/TypeScript 的 `import`、`require`，Java 的 import/package 使用，Python 的 import，Go 的 import。只读源码，不执行源码。
5. 按风险和重要性排序，选择最多 20 个 PURL。
6. 对每个 PURL 写清楚选择理由和风险信号。
7. 调用 `dependency_update_check` 工具。
8. 报告升级检查摘要、artifact 路径、未能查询的 PURL，以及后续建议。


## 选择理由要求

每个候选项至少说明：

- 为什么它重要。
- 它是否是直接依赖。
- 它是否在源码中被真实使用。
- 它和安全风险或业务关键路径的关系。

选择理由应写在最终报告中，保持为可审阅的中文短句，不要只写“版本旧”。

如果只能从 SBOM 看到依赖，但没有找到源码引用，应降低优先级，并在风险信号中体现它只是 SBOM 证据。

如果确认是测试或开发依赖，应降低优先级，除非用户明确要求检查开发依赖。

## 输出要求

最终回答应包含：

- 实际检查的 PURL 数量。
- 有可升级版本的数量。
- `dependency-update-check.json` 的 artifact 路径。
- 最重要的几个升级候选及其选择原因。
- 查询失败或后端未命中的 PURL。

不要把完整 artifact 内容粘贴到对话中，除非用户明确要求。

## 边界

本技能不负责：

- 直接修改 manifest 或 lockfile。
- 运行 `npm install`、`mvn test`、`pip install` 等依赖安装或构建命令。
- 启动后端服务、数据库、消息队列、前端 dev server 或项目运行入口。
- 自动选择最终修复版本。
- 处理兼容性补丁。

这些动作应交给后续的依赖升级应用和验证技能。
