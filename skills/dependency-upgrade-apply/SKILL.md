---
name: dependency-upgrade-apply
description: 根据升级检查结果修改 manifest 文件中的依赖版本，更新 lockfile，并验证构建
---

# 依赖升级执行

当用户确认要执行依赖升级，或者上一阶段（candidate-check）已经给出升级建议后，使用本技能。

本技能只负责执行升级操作，不负责筛选候选依赖、不负责兼容性修复。

## 前置条件

执行前需要以下信息，优先从当前会话上下文中获取：

- `dependency-update-check.json` artifact 路径（含推荐升级版本）
- `./repos/<repo-name>/` 目标仓库路径
- 用户对升级范围的确认（全部升级 or 指定某些依赖）

如果缺少升级建议，先调用 `dependency_update_check` 工具获取推荐版本。

## 核心原则

- 只升级经过确认的依赖，不要擅自扩大范围。
- 每次只修改 manifest 中的版本号字段，不要改动其他内容。
- 更新完 manifest 后必须更新 lockfile，保持依赖解析一致性。
- 不修改无关文件，不格式化代码，不重构。
- 如果某个依赖升级失败（版本不存在、解析冲突），回退该依赖的更改并报告原因。

## 执行流程

### 1. 修改 manifest 文件

根据包管理器类型执行版本替换：

| 生态 | Manifest | 升级方式 |
|------|----------|---------|
| npm | package.json | 直接修改 version 字段 |
| Python | requirements.txt / pyproject.toml | 修改版本约束 |
| Maven | pom.xml | 修改 `<version>` 标签 |
| Go | go.mod | 修改 `require` 行版本 |

修改时注意：
- 只改动推荐升级版本号，保持格式不变。
- 如果同一个依赖出现在多个位置（如 dependencies 和 devDependencies），全部更新。
- Maven 项目中属性引用的版本（`${property.version}`），更新属性定义而非每个引用处。

### 2. 更新 lockfile

修改 manifest 后，运行对应包管理器的 lockfile 更新命令：

```powershell
# npm / node
npm install --package-lock-only

# Maven
mvn versions:use-releases -Dincludes=groupId:artifactId
mvn dependency:resolve

# Python
pip install -r requirements.txt --dry-run

# Go
go mod tidy
```

如果 lockfile 更新失败，回退 manifest 修改并报告具体错误。

### 3. 验证构建

在用户明确允许的情况下，运行构建验证：

```powershell
# npm
npm run build 2>&1

# Maven
mvn compile -q 2>&1

# Go
go build ./... 2>&1
```

如果构建失败：
- 收集编译错误信息。
- 如果错误与升级的依赖相关，说明不兼容。
- 如果错误与升级无关（已有问题），说明现状。
- 回退有问题的升级，保留无问题的升级。

### 4. 报告结果

最终报告包含：

- 成功升级的依赖列表（旧版本 → 新版本）。
- 升级失败的依赖及失败原因。
- lockfile 更新状态。
- 构建验证结果（如果执行了）。
- 剩余未解决的兼容性问题（引导到 `dependency-upgrade-compatibility-fix` 技能）。

## 安全约束

- 不要运行 `git commit`、`git push` 或创建 PR。
- 不要修改非依赖版本管理的文件。
- 不要在未获得确认的情况下升级额外依赖。
- 不要删除或覆盖已有的 lockfile，应主动更新它。
- 构建失败时应回退变更，不要强行提交损坏的构建。

## 边界

本技能不负责：

- 筛选升级候选（那是 candidate-check 的工作）。
- 修补 API 不兼容或代码层面的兼容性问题（那是 compatibility-fix 的工作）。
- 审查许可证变更、法律合规或其他非技术问题。
- 部署、发布或 CI/CD 相关操作。
