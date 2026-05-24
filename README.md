# SSC Agent

SSC Agent 是一个面向开源项目的供应链安全分析 agent。你给它一个 GitHub 仓库 URL，它会在 GitHub Actions 中克隆项目、静态发现依赖、查询 OSV 漏洞数据，并生成中文分析报告和修复建议。

默认流程不会修改目标项目代码，只执行：

1. 依赖发现
2. OSV 漏洞审阅
3. 影响评估与修复方案

阶段四“静态修复”和阶段五“验证”只有在你手动选择授权模式后才会执行。

## 快速上手

### 1. Fork 仓库

先 Fork 本仓库到你自己的 GitHub 账号或组织下。

进入 Fork 后，打开：

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

可选 OpenAI：

```text
Secrets:
OPENAI_API_KEY=你的 OpenAI API Key
```

可选 Anthropic：

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
SMOKE_MODEL=gpt-5
```

也可以使用更轻量的 OpenAI 模型：

```text
SMOKE_PROVIDER=openai
SMOKE_MODEL=gpt-5-mini
```

如果使用 Anthropic：

```text
SMOKE_PROVIDER=anthropic
SMOKE_MODEL=claude-sonnet-4-5
```

`DEEPSEEK_BASE_URL` 通常不用配置，默认是：

```text
https://api.deepseek.com
```

只有在你使用代理或兼容网关时才需要设置。

## 在 GitHub Actions 中运行

进入：

```text
Actions -> Agent CI -> Run workflow
```

填写：

```text
repo_url=https://github.com/snyk-labs/nodejs-goof.git
execution_mode=analysis_only
debug_enabled=false
```

`repo_url` 是要分析的开源项目地址。

### 执行模式

`execution_mode` 控制 agent 被授权执行到哪个阶段：

| 模式 | 含义 |
| --- | --- |
| `analysis_only` | 默认模式，只执行依赖发现、OSV 查询、影响评估和修复方案 |
| `repair` | 允许进入静态修复阶段，可能修改工作区中克隆的目标项目文件 |
| `repair_and_validate` | 允许静态修复和验证，可能运行安装、测试、构建或服务启动命令 |

建议首次使用保持：

```text
analysis_only
```

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
osv-query-result.json
upgrade-plan.md
```

常见含义：

| 文件 | 用途 |
| --- | --- |
| `dependency-discovery.json` | agent 从 manifest、lockfile、源码引用中发现的依赖和 PURL |
| `osv-query-result.json` | OSV 漏洞查询结果 |
| `upgrade-plan.md` | 中文修复建议、优先级排序和风险说明 |

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
  vulnerability-impact-analysis/
  source-dependency-reachability/
  dependency-upgrade-compatibility-fix/
```

## 安全边界

- 默认 `analysis_only` 不修改目标项目源码。
- API Key 必须放在 GitHub Secrets 或本地 `.env` 中。
- GitHub Actions runner 是临时环境，job 结束后会销毁。
- 需要长期保存结果时，请下载 `agent-data` artifact。
- 不建议在公开日志中输出 secrets、token、私有仓库内容或完整 lockfile。
