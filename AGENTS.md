# Git 上传边界

本仓库的 `origin` 用于部署聆风 Web 服务。默认只提交和推送 Web 页面、服务接口，以及 Web 构建确实依赖的共享文件。桌面 Agent 应用保留在本地工作区；除非用户明确改变此约束，不得将其源码、测试、安装包或构建产物上传到此远端。

- 允许上传：`apps/web/**`、Web 使用的 `packages/ui/**` 和 `packages/skills/**`，以及使 Web 能独立安装、测试、构建、部署所需的根目录配置（如 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`vitest.config.ts`、`.pnpmfile.mjs`、`patches/**`、`.gitignore`、`.gitattributes`、本文件）。Web 部署说明可随 Web 代码提交。
- 禁止上传：`apps/agent/**`、根目录 `Cargo.toml` 和 `Cargo.lock`、桌面安装包与本地构建产物、仅供桌面使用的资源或文档、密钥和本地数据。`.gitignore` 已覆盖主要路径，但已被 Git 跟踪的文件不受忽略规则保护。
- 提交前只显式暂存本次需要的路径，不使用 `git add .`、`git add -A` 或无范围的 `git commit -a`。检查 `git diff --cached --name-only` 与 `git ls-files`，确认没有桌面端路径和敏感文件。若某文件同时服务 Web 与桌面端，先确认 Web 构建确实依赖，再决定是否上传。
- 若桌面文件已被跟踪，只从 Git 索引移除并保留本地文件；不要为整理远端仓库删除用户的桌面源码。推送前用仅包含拟上传文件的干净目录验证 Web 安装、测试和构建。
