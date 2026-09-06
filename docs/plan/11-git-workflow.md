# Git 管理约定

项目使用 `main` 作为稳定主分支。功能开发从最新 `main` 建立短期分支，推荐命名：

- `feature/<能力>`：新增功能；
- `fix/<问题>`：缺陷修复；
- `docs/<主题>`：仅文档；
- `release/<版本>`：发布准备。

提交信息采用简明的 Conventional Commits 形式，例如 `feat: add supplier outreach workflow`、`fix: prevent duplicate video submissions`。一次提交只表达一个可审阅目的，不混入本机数据、密钥或无关生成文件。

提交前至少执行：

```powershell
pnpm check
git diff --check
git status --short
```

凭据只通过管理员页面写入本机加密配置。`.env`、`.local/`、依赖、构建缓存、测试结果和 TypeScript 增量缓存均不进入版本库。验收报告中的小型媒体可作为可复查证据提交；超过 10 MB 的媒体或数据集应改用制品存储或 Git LFS，并在引入前单独评估。

合并到 `main` 前应满足：变更目的清楚、检查通过、没有明文凭据、已说明已知限制。发布版本使用带注释标签，例如：

```powershell
git tag -a v0.3.0 -m "AgentSale v0.3.0"
```

远程仓库尚未配置；配置后使用 `git push -u origin main` 首次发布。添加远程地址或推送属于后续明确操作。
