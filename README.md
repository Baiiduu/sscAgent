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

## 普通仓库分析

进入：

```text
Actions -> Agent CI -> Run workflow
```

填写：

```text
repo_url=https://github.com/snyk-labs/nodejs-goof.git
execution_mode=reachability_analysis
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

建议首次使用：

```text
reachability_analysis
```

如果你想学习漏洞如何触发，选择：

```text
remediation_reproduction
```

这个模式会尽量生成 `poc.md`。PoC 默认用于本地学习、解释和授权测试，不是武器化 exploit。

## SEC-bench Patch 单测

本仓库提供了一个独立 workflow：

```text
Actions -> SEC-bench Single -> Run workflow
```

默认实例：

```text
instance_id=mruby.cve-2022-0240
eval_mode=medium
debug_enabled=false
```

它会执行：

```text
1. 读取 benchmarks/secbench/instances.json
2. 调用本项目 agent 生成 patch.diff
3. 转换为 SEC-bench evaluator 支持的 smolagent output.jsonl
4. checkout 官方 SEC-bench 仓库
5. 调用官方 evaluator
6. 读取 report_<mode>.jsonl
7. 在 GitHub Summary 输出 success / failed
```

`eval_mode` 是 SEC-bench patch evaluator 的判定模式：

| 模式 | 含义 |
| --- | --- |
| `strict` | 最严格，通常要求最终 exit code 为 0 且无 sanitizer |
| `medium` | 官方默认风格，要求 exit code 匹配数据集记录且无 sanitizer |
| `generous` | 较宽松，重点看是否执行到最终 PoC 阶段、无超时、无 sanitizer |

单测结果按 SEC-bench 风格展示：

```text
Success: true
Score: 1 / 1
Resolved: 100%
```

失败时：

```text
Success: false
Score: 0 / 1
Resolved: 0%
```

### SEC-bench 产物

`SEC-bench Single` 会上传 artifact：

```text
secbench-agent-data
```

重点目录：

```text
.agent-data/
  workspaces/
    sessions/
      <session>/
        repos/
        artifacts/
  secbench/
    <instance_id>/
      patch.diff
      output.jsonl
      summary.json
  secbench-eval/
    <instance_id>/
      report_medium.jsonl
```

`output.jsonl` 是给官方 evaluator 的输入，格式类似：

```json
{
  "instance_id": "mruby.cve-2022-0240",
  "test_result": {
    "git_patch": "diff --git ..."
  }
}
```

`report_<mode>.jsonl` 是官方 evaluator 的输出，关键字段包括：

```json
{
  "instance_id": "mruby.cve-2022-0240",
  "success": true,
  "reason": "Patch evaluation succeeded.",
  "exit_code": 0,
  "model_name": "unknown_model"
}
```

SEC-bench 官方 evaluator 会拉取 Docker eval 镜像。默认实例的镜像压缩大小约 0.9 GiB，首次运行可能需要较长时间。

## 查看普通分析结果

`Agent CI` workflow 运行结束后，打开本次 Actions run 页面，下载 artifact：

```text
agent-data
```

重点查看：

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

## Finding Console

Agent 会在项目级分析过程中，把每个可独立追踪的漏洞假设记录为 finding，并把发现、可达性分析、PoC 验证、修复和阻塞原因记录为 finding event。原有项目级报告和 artifact 仍然保留；Finding Console 只是把同一次分析按单个漏洞拆开查看。

本地启动：

```bash
bun run findings:server
```

默认监听：

```text
http://127.0.0.1:8787
```

在 GitHub Actions 中，只有 `debug_enabled=true` 时才会后台启动 Finding Console。通过 tmate 连接 runner 后，可以在本地做端口转发：

```bash
ssh -L 8787:127.0.0.1:8787 <tmate ssh command>
```

然后在浏览器打开：

```text
http://127.0.0.1:8787
```

页面左侧是 finding 列表，右侧是单个 finding 的详情和事件流。当前版本是只读视图，不提供 agent 交互区。

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

运行普通仓库分析：

```bash
bun run analyze https://github.com/snyk-labs/nodejs-goof.git
```

运行 SEC-bench 单测 agent 生成阶段：

```bash
bun run secbench:single -- --instance mruby.cve-2022-0240
```

解析 SEC-bench evaluator 报告：

```bash
bun run secbench:report -- \
  --instance mruby.cve-2022-0240 \
  --mode medium \
  --report .agent-data/secbench-eval/mruby.cve-2022-0240/report_medium.jsonl
```

类型检查：

```bash
bun run check
```

## 项目结构

```text
benchmarks/
  secbench/
    instances.json

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
- `SEC-bench Single` 的最终成功与否由官方 evaluator 判定，不由 agent 自行声明。
- API Key 必须放在 GitHub Secrets 或本地 `.env` 中。
- GitHub Actions runner 是临时环境，job 结束后会释放。
- 需要长期保存结果时，请下载对应 artifact。
- 不建议在公开日志中输出 secrets、token、私有仓库内容或完整 lockfile。
