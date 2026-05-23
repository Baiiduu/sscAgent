---
name: source-dependency-reachability
description: 分析漏洞依赖在项目源码中的实际可达性，判断是否被真实调用
---

# 源码级依赖可达性分析

当用户关心某个漏洞依赖是否真正影响项目，或者需要区分“存在但不使用”和“真实可达”时，使用本技能。

本技能只负责静态分析依赖是否被源码实际引用，不负责评估漏洞严重性、升级依赖、生成 SBOM、安装依赖、运行测试或修改文件。

## 分析目标

对给定的漏洞依赖判断可达性状态：

| 状态 | 含义 |
| --- | --- |
| direct_reachable | 源码直接 import/require/use 该依赖，并可能调用受影响 API |
| transitive_reachable | 通过直接依赖间接引入，且调用链可追踪到项目源码 |
| not_imported | 依赖存在于 manifest、lockfile、SBOM 或 OSV 结果中，但源码未发现引用 |
| dead_code | 引用位于注释、测试、条件排除或不可达路径中 |
| unknown | 静态证据不足，无法可靠判断 |

## 输入证据

优先读取：

```text
./repos/<repo-name>/
./artifacts/<repo-name>/osv-query-result.json
./artifacts/<repo-name>/dependency-update-check.json
```

可以使用已有 SBOM 作为补充证据，但不要生成 SBOM，也不要调用 `sbom_generate`：

```text
./artifacts/<repo-name>/sbom.cdx.json
./artifacts/<repo-name>/sbom-summary.json
```

如果仓库尚未克隆，先使用 `git-clone` 技能克隆。

## 执行流程

### 1. 确定分析目标

从以下来源获取待分析依赖：

- 当前会话已有的 `vulnerability_lookup` 或 OSV 查询结果
- 当前会话已有的 `dependency-discovery.json`
- 用户指定的 PURL、包名、CVE/GHSA/OSV ID
- manifest 或 lockfile 中的依赖
- 已存在 SBOM 中的 components

每个目标应尽量包含包名、生态、版本和漏洞 ID。

如果本次分析过程中重新发现或筛选了依赖目标，必须同步写入或更新：

```text
./artifacts/<repo-name>/dependency-discovery.json
```

不要只把依赖清单保存在对话中。

### 2. 搜索源码引用

根据生态使用静态搜索：

- JavaScript/TypeScript: 搜索 `import`, `require`, dynamic import, framework config
- Python: 搜索 `import`, `from ... import`
- Java/Kotlin: 搜索 `import`, package usage, build dependency coordinates
- Go: 搜索 import path
- Ruby/PHP/Rust/.NET: 搜索对应语言的 import/use/require 声明

包名包含 scope、连字符、模块子路径时，要尝试多种匹配方式，例如 `lodash`、`lodash/merge`、`@scope/name`。

### 3. 判断受影响 API

如果漏洞描述指出特定函数、类、方法、配置项或协议路径，继续搜索这些 API 是否在项目源码中出现。

仅发现依赖存在但没有源码引用时，不要标记为 reachable。

### 4. 分析传递依赖

对于传递依赖：

1. 从 lockfile、manifest、已有 SBOM 或 OSV 结果识别引入链。
2. 找到引入该传递依赖的直接依赖。
3. 检查项目源码是否使用该直接依赖。
4. 如果调用链证据不足，标记为 `unknown` 或 `not_imported`，不要猜测。

### 5. 排除低相关证据

降低以下引用的优先级：

- 测试文件、示例、fixture、demo
- 注释中的字符串
- 构建脚本或开发工具路径
- 条件编译排除路径
- 仅在文档中出现的包名

## 输出格式

输出结构化结果：

```json
{
  "repositoryPath": "./repos/<repo-name>",
  "analyzedDependencies": [
    {
      "purl": "pkg:npm/lodash@4.17.20",
      "cveIds": ["CVE-2020-28500"],
      "reachability": "direct_reachable",
      "evidence": [
        {
          "file": "src/utils/helper.ts",
          "line": 5,
          "type": "import",
          "content": "import { merge } from 'lodash'"
        }
      ],
      "affectedApiUsed": true,
      "risk": "high"
    }
  ],
  "summary": {
    "totalAnalyzed": 10,
    "directReachable": 3,
    "transitiveReachable": 2,
    "deadCode": 1,
    "notImported": 3,
    "unknown": 1
  }
}
```

## 安全边界

- 只读源码和依赖声明。
- 不安装依赖。
- 不执行项目代码。
- 不启动服务。
- 不修改任何文件。
- 不生成或修改 SBOM。
