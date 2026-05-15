---
name: source-dependency-reachability
description: 分析漏洞依赖在项目源码中的实际可达性，判断是否被真实调用
---

# 源码级依赖可达性分析

当用户关心某个漏洞是否真正影响到项目、需要区分"存在但不可达"和"真实可达"的漏洞时，使用本技能。

本技能只负责分析"漏洞依赖是否被源码实际调用"，不负责评估漏洞严重性、不负责升级依赖。

## 分析目标

对于给定的漏洞依赖，判断其在项目源码中的可达性状态：

| 状态 | 含义 |
|------|------|
| direct_reachable | 源码直接 import/require 了该漏洞包，且调用了受影响 API |
| transitive_reachable | 通过传递依赖引入，但调用链可追踪到受影响代码路径 |
| dead_code | 存在引用但位于死代码路径（条件编译排除、已注释、废弃分支） |
| not_imported | 依赖存在于 SBOM/lockfile 但源码中从未 import/require |
| unknown | 无法确定，需要人工审查 |

## 前置准备

优先从当前会话工作区读取：

```text
./repos/<repo-name>/        # 源代码目录
./artifacts/<repo-name>/sbom.cdx.json   # SBOM，含组件清单和依赖关系
./artifacts/<repo-name>/sbom-summary.json
```

如果仓库尚未克隆，先使用 `git-clone` 技能克隆。

如果 SBOM 不存在，先调用 `sbom_generate` 工具生成。

## 执行流程

### 1. 确定分析目标

从以下来源获取待分析的漏洞依赖列表：

- 当前会话中已有的 `vulnerability_lookup` 或 OSV 查询结果。
- 用户直接指定的 PURL 或 CVE 列表。
- `sbom.cdx.json` 中的 components 列表。

每个待分析的依赖应至少包含：包名、版本、生态、已知漏洞 ID。

### 2. 按生态搜索源码引用

根据包管理器生态，使用对应的搜索策略：

**JavaScript/TypeScript (npm)：**

```powershell
# 搜索 import 语句
Select-String -Path ".\repos\<repo-name>\**\*.{js,jsx,ts,tsx}" -Pattern "require\(['`"]<package-name>['`"]\)|from ['`"]<package-name>['`"]" -List
```

**Java/Maven：**

```powershell
Select-String -Path ".\repos\<repo-name>\**\*.java" -Pattern "import\s+<group-id-or-prefix>\.<artifact-id>" -List
```

**Python：**

```powershell
Select-String -Path ".\repos\<repo-name>\**\*.py" -Pattern "^import\s+<package-name>|^from\s+<package-name>" -List
```

如果包名包含特殊字符（如 `@scope/name`、带连字符等），尝试多种搜索模式：

- 精确匹配包名。
- 匹配包名的主要部分（如 `lodash` 匹配 `lodash/merge`）。
- 对于传递依赖，搜索直接依赖的代码中是否 re-export 了目标包。

### 3. 确定受影响 API 的调用

如果漏洞描述中指明受影响的具体函数/方法/类：

```powershell
# 搜索受影响 API 在项目中的使用
Select-String -Path ".\repos\<repo-name>\**\*.{js,ts,java,py}" -Pattern "<affected-api-name>" -List
```

如果存在调用，标记为 `direct_reachable`。

如果依赖被 import 但未调用受影响 API，标记为 `low_risk` 并说明情况。

### 4. 分析传递依赖链

对于不是直接依赖的包：

- 读取 `sbom.cdx.json` 中的 `dependencies` 数组，查找引入该传递依赖的直接依赖。
- 在直接依赖的代码中搜索对该传递依赖的引用（re-export / re-require）。
- 搜索项目代码中对该直接依赖的使用。

如果调用链能完整追溯到项目源码，标记为 `transitive_reachable`。

如果调用链在传递依赖层断裂（该依赖被引入但未实际使用），标记为 `not_imported`。

### 5. 排除死代码

当找到引用后，验证代码路径是否有效：

- 如果引用位于被条件编译排除的代码（如 `// @ts-ignore`、`#ifdef`、平台特定分支），标记为 `dead_code`。
- 如果引用位于测试文件（`*.test.js`、`*Test.java`、`test_*.py`）且用户未要求分析测试依赖，降低优先级并标注。
- 如果引用位于已被注释的代码块中，标记为 `dead_code`。

### 6. 汇总结果

输出格式：

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

## 安全约束

- 只读源码，不执行源码、不安装依赖、不启动项目。
- 不要修改任何文件。
- 不要使用需要安装或编译的分析工具。

## 边界

本技能不负责：

- 评估漏洞严重性或优先级（那是 impact-analysis 的工作）。
- 生成或修改 SBOM。
- 修复漏洞或升级依赖。
- 运行测试或构建验证。
