# AgentSale · 中国工厂产品的海外分销运营平台

自主经营 Agent 版 v0.6 · 2026-09-06。运营入口改为自然语言和 `/命令` 驱动的持续运行 Agent；研究、决策、内容和执行子流程由后台编排。平台数据快照、五维评分、商品文案、海报、视频及 MiniMax 接口继续作为 Agent 工具。海外平台数据、发布和订单连接器尚未完成接入。

从中国大陆可供货、支持单件代发的供应商出发，由 AI 根据保存的发货证据选择商品与海外市场。延续已确认的苹果风：白色与冷灰、简洁列表、少量蓝色操作、浅色和深色外观。

## 启动与首次使用

本机验证 Node.js 24.19.0、pnpm 11.19.0；视频需要 FFmpeg 和 ffprobe 在 PATH 中。根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 或 `pnpm start` 会同时启动两个独立门户：

- [运营工作台](http://127.0.0.1:3045)：仅运营账号，用于商品、供应商、内容、自动化和审阅；
- [管理控制台](http://127.0.0.1:3047)：仅管理员账号，用于模型、密钥、额度、账号和审计。

首次使用在管理控制台创建管理员账号，无默认密码；再由管理员建立运营账号。首次数据库初始化包含明确标记的虚构示例商品。

1. 管理员进入独立管理控制台，填写模型接口、模型名称与密钥，配置 Brave Search、单次和每日调用预留额度，保存并测试模型连接。
2. 管理员建立运营账号。运营可以管理商品、启动流程、上传素材、修改和审阅内容，不能读取密钥或修改服务与额度。
3. 在「Agent」中输入经营目标并执行 `/start`；Agent 会根据供货证据、市场数据、成本和当前连接器持续决定下一步。也可用 `/discover`、`/content <SKU>` 单独启动子流程。
4. 从商品启动「生成商品内容包（已有商品资料）」制作草稿；需要先复核供货时选择「供货复核 → 完整商品内容包」。上传授权商品图，按需选择配音或海螺视频，完成后预览、编辑和下载。
5. 没有模型账号时，可以上传图片与三段文字，使用「已有图片与文案 → 海报与视频」。默认本机排版与编码，不调用模型；可选的 MiniMax 配音或动态视频需要对应配置。

保存配置不等于连接成功。模型接口使用 Chat Completions，支持 JSON Schema、JSON 模式或提示词约束 JSON；兼容性以实际连接验证为准。远程模型验证也受调用预留额度约束。密钥通过管理员页面配置，不放入源码。

正式构建运行：`pnpm build` 后 `pnpm start`。完整检查：`pnpm check`（类型检查、52 项测试、生产构建）。exFAT 兼容由根目录启动工具处理。

常用 Agent 命令：`/goal <目标>`、`/budget <美元>`、`/interval <分钟>`、`/start`、`/pause`、`/run`、`/discover [方向]`、`/content <SKU>`、`/status` 和 `/help`。常见中文自然语言会直接映射为安全动作；其他表达在模型已验证后由结构化意图解析器处理。

## 已实现的行为

| 能力 | 当前行为 |
|---|---|
| 供应商发现 | Brave Search 搜索、公开 HTML 采集、保存正文/来源/时间/摘要哈希；来源访问失败明确记录 |
| AI 选品与市场 | 模型返回结构化候选；大陆供货、单件代发和目的国配送引用须在来源中逐字存在，缺证据不允许确定选择 |
| 市场决策 | 保存 TikTok Shop、Temu、Amazon、Shopify 或其他平台的数据快照；按需求、竞争、内容、履约、经济性评分，显示覆盖率、趋势、置信度与下一步 |
| Agent 执行层 | 持久保存目标、周期预算、运行间隔、消息和动作；自动编排研究、决策、内容及内部审阅，并在连接器缺失时报告具体阻塞 |
| 供货研究 | 形成供应商与市场报告、缺失信息和询价草稿；有合格候选时自动建立待核实商品 |
| 商品内容 | 标题、卖点、规格、详情与 SEO，HTML/TXT/JSON 导出；另含社交文案和三段分镜，可统一编辑 |
| 海报 | 保留授权商品图片，自动输出 1080×1080、1080×1350、1080×1920 PNG |
| 视频 | 默认 15 秒本机分镜；可选 MiniMax 配音或 6 秒海螺图生视频，取回后生成最终竖屏 MP4 |
| 持久流程 | 步骤进度、暂停/继续/取消、版本检查、幂等创建、中断后人工继续、素材下载和审阅记录 |
| 权限与配置 | 管理员/运营服务端权限、8 小时登录会话、账号停用、密钥本机加密、调用预留账本 |
| 原有业务基础 | 商品和证据录入、精确成本测算、模板历史、商品店铺预览 |

**验证边界：**自动化测试使用合成资料与 HTTP 测试服务；用户另授权 Token Plan 实测，文本连接、业务研究、完整商品文案、配音及海螺视频下载均已返回真实结果，最终成片已在浏览器播放，详见 [v0.3 验收报告](docs/reports/2026-09-06-content-kit-minimax.md)。测试图片和商品资料是合成素材，不代表真实供货推荐。

供应商消息发送、自动洽谈、多平台发布、结账支付、订单物流与佣金结算尚未接入。询价、推广均输出待审阅文件，店铺仍为排版预览。

## 数据与运行边界

运营后端监听本机 `127.0.0.1:3045`，独立管理前端监听 `127.0.0.1:3047`。管理前端只代理身份与管理接口，不代理商品、内容或自动化接口。API 检查会话、精确角色、Host 和写入 Origin：管理员不能调用运营业务接口，运营不能调用管理接口。当前仍是同一电脑、单工作区的应用层职责分离，不是公网多租户部署；拥有同一 Windows 账号和本机文件权限的人不在应用权限隔离范围内。

PGlite 数据在 `%LOCALAPPDATA%/AgentSale/<项目名及路径摘要>/pglite`。本机实际目录：

```text
C:\Users\Administrator\AppData\Local\AgentSale\CD045_AgentSale-cd0898b7\pglite
```

其同级 `automation/` 保存图片、视频与加密配置；Windows 密钥由当前用户 DPAPI 保护。只返回密钥是否存在，不返回明文；更换模型端点清除旧模型密钥，所有配置修改都使连接验证失效。

每个数据目录仅运行一个服务进程。打开应用后后台工作器开始处理任务，关闭浏览器不停止已运行服务；关闭进程则停止。重启后不盲目重发可能计费的中断请求，需在流程中继续。调用额度是保守预留，并非服务商实际账单；未知结果继续占用预留。

`AGENTSALE_DATA_DIR` 可指定独立 NTFS 数据目录，`AGENTSALE_PORT` 可改变运营端口；管理端口默认为运营端口加 2，也可由 `AGENTSALE_ADMIN_PORT` 指定。根启动脚本不自动读取 `.env.example`。隔离验收使用运营端口 3046、管理端口 3048 和 `qa-automation-20260906` 数据目录，测试账号不进入正常工作区。

## 文档与文件组织

- [商品内容包与 MiniMax](docs/plan/10-content-kit-and-minimax.md)
- [Git 管理约定](docs/plan/11-git-workflow.md)
- [管理与运营门户隔离](docs/plan/12-portal-and-role-separation.md)
- [市场决策层](docs/plan/13-market-decision-layer.md)
- [v0.5 决策层验收报告](docs/reports/2026-09-06-market-decision-layer.md)
- [自主经营 Agent 与执行层](docs/plan/14-autonomous-agent-runtime.md)
- [v0.6 Agent 执行层验收报告](docs/reports/2026-09-06-autonomous-agent-runtime.md)
- [v0.4 门户隔离验收报告](docs/reports/2026-09-06-portal-separation.md)
- [v0.3 验收报告](docs/reports/2026-09-06-content-kit-minimax.md)
- [当前自动化、角色与技术方案](docs/plan/09-automation-and-access.md)
- [本次实现与验收证据](docs/reports/2026-09-06-automation-implementation.md)
- [执行总纲](docs/plan/00-execution-plan.md)、[产品需求](docs/plan/01-product-requirements.md)、[目标架构](docs/plan/02-architecture.md)
- [Agent 工作流](docs/plan/03-agent-workflows.md)、[外部集成](docs/plan/04-integrations-and-validation.md)、[视觉规范](docs/plan/05-frontend-design.md)
- [交付路线](docs/plan/06-delivery-roadmap.md)、[决策记录](docs/plan/07-decisions-and-sources.md)
- [历史首批范围](docs/plan/08-first-implementation.md)、[历史首批验收](docs/reports/2026-09-06-phase01-implementation.md)、[视觉样稿](docs/design/agent-sale-preview.html)

`apps/console/` 为运营前端和业务后端，`apps/admin-console/` 为独立管理前端及受限代理；`packages/automation/` 为流程、模型/搜索、凭据、权限和媒体；`packages/database/` 为数据与隔离；`packages/contracts/`、`domain/`、`ui/` 为数据约定、计算和视觉；`tests/`、`scripts/`、`docs/` 各自保存验证、工具和文档。项目已由本机 Git 管理，尚未配置远程仓库或部署公网；MiniMax 实测使用用户明确提供的 Token Plan。
