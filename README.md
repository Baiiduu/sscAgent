# SSC Agent

SSC Agent 是一个面向开源项目的安全分析 agent。你给它一个 GitHub 仓库 URL，它会在 GitHub Actions 中克隆项目，执行上游漏洞分析、可达性分析，并在授权后进入 PoC、复现、修复和验证阶段。

默认推荐模式是 `reachability_analysis`：它不仅看“依赖是否命中已知漏洞”，还会判断“这个项目是否真的可能用到受影响路径”。

## 快速上手

### 1. Fork 仓库

先 Fork 本仓库到你自己的 GitHub 账号或组织下。

进入 Fork 后打开：

```text
Settings -> Secrets and variables -> Actions
```

### 2. 配置 API Key

至少配置一个模型供应商的 API Key。

推荐 DeepSeek：

```text
Secrets:
DEEPSEEK_API_KEY=你的 DeepSeek API Key
```

也可以使用 OpenAI：

```text
Secrets:
OPENAI_API_KEY=你的 OpenAI API Key
```

也可以使用 Anthropic：

```text
Secrets:
ANTHROPIC_API_KEY=你的 Anthropic API Key
```

不要把 API Key 写进代码、README、Issue 或 workflow 日志。

### 3. 配置模型变量

在同一页面进入 `Variables`，配置：

```text
SMOKE_PROVIDER=deepseek
SMOKE_MODEL=deepseek-v4-flash
```

也可以使用：

```text
SMOKE_PROVIDER=deepseek
SMOKE_MODEL=deepseek-v4-pro
```

如果使用 OpenAI：

```text
SMOKE_PROVIDER=openai
SMOKE_MODEL=gpt-5.5
```

另一个推荐 OpenAI 模型：

```text
SMOKE_PROVIDER=openai
SMOKE_MODEL=gpt-5.4
```

如果使用 Anthropic：

```text
SMOKE_PROVIDER=anthropic
SMOKE_MODEL=claude-sonnet-4-5
```

`DEEPSEEK_BASE_URL` 通常不用配置。只有在你使用代理或兼容网关时才需要设置。

## 在 GitHub Actions 中运行

进入：

```text
Actions -> Agent CI -> Run workflow
```

填写：

```text
repo_url=https://github.com/snyk-labs/nodejs-goof.git
execution_mode=reachability_analysis
benchmark_name=swc-bench
debug_enabled=false
```

`repo_url` 是要分析的开源项目地址。

### 执行模式

`execution_mode` 控制 agent 执行到哪个阶段：

| 模式 | 含义 |
| --- | --- |
| `upstream_analysis` | 只做上游分析：依赖识别、已知漏洞匹配、源码候选发现 |
| `reachability_analysis` | 默认推荐：上游分析 + 可达性/影响判断 + 中文处置建议 |
| `remediation_reproduction` | 允许生成教学型 PoC、复现、修复、验证，可能修改工作区中的目标项目文件 |
| `benchmark` | 预留给 SWC-bench、SEC-bench 等 benchmark 任务，按任务协议运行 |

建议首次使用：

```text
reachability_analysis
```

如果你想学习漏洞如何触发，选择：

```text
remediation_reproduction
```

这个模式会尽量生成 `poc.md`。PoC 默认用于本地学习、解释和授权测试，不是武器化 exploit。

`benchmark_name` 当前预留为：

```text
swc-bench
```

只有当 `execution_mode=benchmark` 时，它才有实际意义。

### 调试模式

如果打开：

```text
debug_enabled=true
```

workflow 会在分析后启动 tmate session，方便你通过 SSH 进入 GitHub runner 查看现场。

如果启用了：

```yaml
limit-access-to-actor: true
```

你需要在 GitHub 个人账号中配置 SSH public key：

```text
GitHub -> Settings -> SSH and GPG keys
```

## 查看分析结果

workflow 运行结束后，打开本次 Actions run 页面，下载 artifact：

```text
agent-data
```

它包含 `.agent-data` 下的运行数据。重点查看：

```text
dependency-discovery.json
security-candidates.json
triage-report.json
risk-ranking.md
upgrade-plan.md
poc.md
repro-script.*
repair-summary.md
validation-report.md
patch.diff
```

常见含义：

| 文件 | 用途 |
| --- | --- |
| `dependency-discovery.json` | agent 从 manifest、lockfile、源码引用中发现的依赖和 PURL |
| `security-candidates.json` | 上游分析阶段发现的依赖漏洞候选和源码漏洞候选 |
| `triage-report.json` | 可达性、影响和优先级判断 |
| `risk-ranking.md` | 中文风险排序和解释 |
| `upgrade-plan.md` | 中文处置建议和修复方向 |
| `poc.md` | 教学型 PoC，解释漏洞触发前提、输入路径、危险 sink、预期现象和修复后现象 |
| `repro-script.*` | 可选的本地复现脚本，只在安全、低风险、可本地运行时生成 |
| `repair-summary.md` | 修复复现阶段的修改摘要 |
| `validation-report.md` | 验证命令、结果和剩余风险 |
| `patch.diff` | 修复相关 diff |

## 本地运行

需要先安装 Bun。

安装依赖：

```bash
bun install
```

配置 `.env`：

```text
DEEPSEEK_API_KEY=你的 DeepSeek API Key
SMOKE_PROVIDER=deepseek
SMOKE_MODEL=deepseek-v4-flash
ANALYSIS_EXECUTION_MODE=reachability_analysis
```

运行分析：

```bash
bun run analyze https://github.com/snyk-labs/nodejs-goof.git
```

类型检查：

```bash
bun run check
```

## 项目结构

```text
src/
  agent/        agent profiles and builtin agents
  cli/          command-line entrypoints
  harness/      session loop and runner
  provider/     OpenAI, Anthropic, DeepSeek model registry and loading
  runtime/      default runtime wiring
  storage/      SQLite session persistence
  tool/         builtin tools and SSC tools
  workspace/    session workspace creation

skills/
  git-clone/
  vulnerability-impact-analysis/
  security-discovery/
  security-triage/
  security-remediation/
```

## 安全边界

- `upstream_analysis` 和 `reachability_analysis` 不应修改目标项目源码。
- `remediation_reproduction` 才允许对工作区中的目标项目做最小必要修改。
- PoC 默认是教学型、本地复现型材料，不应输出武器化 exploit、真实凭证或真实攻击目标。
- `benchmark` 必须优先遵守 benchmark 任务协议。
- API Key 必须放在 GitHub Secrets 或本地 `.env` 中。
- GitHub Actions runner 是临时环境，job 结束后会释放。
- 需要长期保存结果时，请下载 `agent-data` artifact。
- 不建议在公开日志中输出 secrets、token、私有仓库内容或完整 lockfile。
