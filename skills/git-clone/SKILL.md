---
name: git-clone
description: 克隆或更新 Git 仓库到当前会话工作目录的 ./repos 目录，并将分析产物限制在 ./artifacts 目录
---

# 将 Git 仓库克隆到会话工作区

当用户要求克隆、拉取或准备一个 Git 仓库用于后续供应链分析时，使用本技能。

## 工作区规则

当前工作目录就是本次会话的 workspace root。所有仓库内容和由本次会话生成的分析产物，都必须保留在当前工作目录内。

当前会话工作区结构如下：

```text
./
  repos/
  artifacts/
  logs/
  tmp/
```

仓库必须克隆到：

```text
./repos/<repo-name>
```

本技能或后续供应链分析产生的文件，必须写入同一个会话工作区的 `./artifacts/` 子目录，例如：

```text
./artifacts/<repo-name>/
```

适合放入 `artifacts/` 的内容包括 SBOM 文件、依赖清单、漏洞扫描结果、可达性分析结果、升级建议、补丁草案、验证摘要和工具输出快照。不要把这些产物写进被克隆仓库内部，除非用户明确要求把某个补丁或配置文件应用到仓库源码中。

不要把仓库克隆到用户主目录、磁盘根目录、项目源码目录、系统临时目录，或任意未授权的绝对路径。默认使用相对路径，让工具从当前 session workspace root 解析。

## 需要从用户请求中识别的信息

从用户请求中提取：

- 仓库 URL，例如 `https://github.com/org/repo.git`。
- 可选目标目录名。如果用户没有指定，从 URL 文件名推断，并去掉 `.git` 后缀。
- 可选分支、标签或提交。如果用户没有指定，使用仓库默认分支。

## 执行流程

1. 将目标目录解析为当前工作目录下 `./repos/` 的子目录。
2. 克隆前检查目标目录是否已经存在。
3. 如果目标目录已经存在，并且是同一个 remote 仓库，则执行 fetch 更新，不要覆盖目录。
4. 如果目标目录已经存在，但不是用户请求的仓库，停止并报告冲突。
5. 只允许使用 `git clone` 克隆到 `./repos/` 之内。
6. 如需保存分析产物，为该仓库创建 `./artifacts/<repo-name>/`。
7. 完成后报告仓库本地路径、产物目录路径和当前 commit。

## 推荐命令

使用 PowerShell 兼容命令，优先使用 PowerShell 的原生命令和路径处理。

检查目标目录：

```powershell
Test-Path -LiteralPath ".\repos\<repo-name>"
```

克隆默认分支：

```powershell
git clone -- "<repo-url>" ".\repos\<repo-name>"
```

克隆指定分支：

```powershell
git clone --branch "<branch>" -- "<repo-url>" ".\repos\<repo-name>"
```

检查已有仓库 remote：

```powershell
git -C ".\repos\<repo-name>" remote get-url origin
```

更新已有仓库：

```powershell
git -C ".\repos\<repo-name>" fetch --all --prune
```

报告当前 commit：

```powershell
git -C ".\repos\<repo-name>" rev-parse HEAD
```

## 安全约束

- 不要使用 `cmd /c`。
- 不要使用 `rmdir`、`rd`、`del`、`Remove-Item -Recurse` 或 `git clean`。
- 不要覆盖已有的非空目录。
- 不要把克隆后的内容移动到 workspace 外。
- 不要把分析产物写到 workspace 外，也不要随意写入被克隆仓库内部。
- 不要把 token 写入命令行、文件或日志。
- 克隆完成后不要自动安装依赖或执行构建，除非用户单独要求。

## 失败处理

如果克隆失败是因为需要认证，说明需要凭据后停止。

如果目标目录和已有内容冲突，报告：

- 用户请求的仓库 URL。
- 目标目录路径。
- 已有仓库 remote URL，如果能读取到。
- 停止执行的原因。

如果网络访问失败，报告失败的 `git` 操作，并保留已经创建的部分目录供检查。
