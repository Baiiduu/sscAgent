---
name: git-clone
description: 将 Git 仓库克隆或更新到当前会话工作区的 ./repos 目录，并支持 checkout 指定 branch、tag 或 commit。
---

# Git 仓库准备

当任务需要分析一个远程 Git 仓库时，使用本技能准备本地工作区。

本技能只负责准备源码目录和 artifact 目录，不负责安装依赖、构建、运行测试、启动服务或做安全分析。

## 工作区约定

当前工作目录就是本次会话的 workspace root。

所有仓库内容必须放在：

```text
./repos/<repo-name>
```

所有分析产物必须放在：

```text
./artifacts/<repo-name>
```

不要把仓库克隆到 workspace 外部，不要写入用户主目录、磁盘根目录、系统临时目录或项目源码目录之外的位置。

## 输入信息

从用户请求或上游任务中提取：

- 仓库 URL，例如 `https://github.com/org/repo.git`
- 可选目标目录名
- 可选 branch
- 可选 tag
- 可选 commit 或 base commit

如果用户没有指定目标目录名，从仓库 URL 推断：

```text
https://github.com/org/example.git -> example
```

## 执行流程

### 1. 解析目标路径

目标仓库路径必须是：

```text
./repos/<repo-name>
```

artifact 路径必须是：

```text
./artifacts/<repo-name>
```

如不存在，创建 `./repos` 和 `./artifacts/<repo-name>`。

### 2. 克隆或更新仓库

如果目标目录不存在，执行 clone：

```powershell
git clone -- "<repo-url>" "./repos/<repo-name>"
```

如果指定 branch：

```powershell
git clone --branch "<branch>" -- "<repo-url>" "./repos/<repo-name>"
```

如果目标目录已存在且是同一 remote 仓库，可以执行 fetch：

```powershell
git -C "./repos/<repo-name>" remote get-url origin
git -C "./repos/<repo-name>" fetch --all --tags --prune
```

如果目标目录已存在但不是同一 remote 仓库，停止并报告冲突，不要覆盖。

### 3. Checkout 指定版本

如果用户指定 branch：

```powershell
git -C "./repos/<repo-name>" checkout "<branch>"
git -C "./repos/<repo-name>" pull --ff-only
```

如果用户指定 tag：

```powershell
git -C "./repos/<repo-name>" checkout "tags/<tag>"
```

如果用户指定 commit 或 base commit：

```powershell
git -C "./repos/<repo-name>" checkout "<commit>"
```

SEC-bench 或类似安全任务通常会提供 `base_commit`。这种情况下必须 checkout 到该 commit，再进入后续分析或修复阶段。

### 4. 记录当前状态

完成后读取：

```powershell
git -C "./repos/<repo-name>" remote get-url origin
git -C "./repos/<repo-name>" rev-parse HEAD
git -C "./repos/<repo-name>" status --short
```

## 输出要求

完成后必须报告：

- `repositoryPath`
- `artifactDir`
- `remoteUrl`
- `currentCommit`
- 使用的 branch、tag 或 commit
- 是否为 detached HEAD
- 是否存在未提交变更

建议同时写出：

```text
./artifacts/<repo-name>/repository-info.json
```

结构示例：

```json
{
  "repositoryPath": "./repos/<repo-name>",
  "artifactDir": "./artifacts/<repo-name>",
  "remoteUrl": "https://github.com/org/repo.git",
  "currentCommit": "abcdef123456",
  "requestedRef": {
    "type": "commit",
    "value": "abcdef123456"
  },
  "detachedHead": true,
  "dirty": false
}
```

## 安全边界

- 不要使用 `cmd /c`。
- 不要使用 `rmdir`、`rd`、`del`、`Remove-Item -Recurse`、`git clean` 等删除命令。
- 不要覆盖已有非空目录。
- 不要把仓库移动到 workspace 外部。
- 不要把 artifact 写到 workspace 外部。
- 不要把 token、API key 或凭证写入命令行、文件或日志。
- 克隆完成后不要自动安装依赖。
- 不要运行构建、测试或服务。
- 不要提交代码或推送远程仓库。

## 失败处理

如果 clone 失败：

- 报告失败的 Git 命令。
- 报告错误摘要。
- 保留已经创建的目录供检查。

如果 checkout 失败：

- 报告请求的 branch、tag 或 commit。
- 报告当前 commit。
- 不要猜测替代 ref。

如果目标目录冲突：

- 报告用户请求的仓库 URL。
- 报告目标目录路径。
- 报告已有仓库 remote URL。
- 停止执行。
