# 决策记录与资料来源

版本：v0.1 / 2026-09-06。外部资料核对日期同上，接入时需复核最新条件。

## 1. 决策登记

| ID | 决策 | 依据 | 状态及变更条件 |
|---|---|---|---|
| D01 | 中国大陆工厂 → 海外市场 | 用户明确产品定位 | 已确认 |
| D02 | 内部工作名 AgentSale | 当前工作区名称 | 默认，品牌与商标未验证 |
| D03 | 中文 Web 后台 + 海外品牌店铺 | 快速试运营与双方使用场景 | 默认，首版不做安装包 |
| D04 | 先内部自营，不对外销售 SaaS | 优先验证商业闭环 | 默认，盈利与稳定运营后复评 |
| D05 | 默认价差转售，暂不建设两层佣金 | 用户“二级分销”含义尚未最终确定 | 待确认，若改佣金模式需补业务设计 |
| D06 | 一个市场、一种主语言、一个主渠道 | 降低首版接入与履约复杂度 | 范围默认，具体国家/渠道待定 |
| D07 | Shopify 托管店铺，不自研结账 | 缩短交易建设周期 | 主体或网关验证不通过时重新评估 |
| D08 | Next.js + PostgreSQL + 队列 Worker | 一个语言栈、持久业务事实与异步工作 | 默认，精确版本在开工时锁定 |
| D09 | 数据库持久工作流，暂不采用 Temporal | 首版流程数量和运维成本 | 工作流复杂度实测增长后复评 |
| D10 | 真实素材模板视频优先 | 产品一致性与成本可控 | 生成视频经评测后按场景补充 |
| D11 | 苹果风参考：纯白/冷灰/石墨黑、少量蓝色动作、轻侧栏与简洁列表 | 用户已明确认可并要求按此执行 | 已确认，后续应用沿用 v0.2，共享 token 统一维护 |
| D12 | 事实、估算、模拟、实际明确区分 | 商业决策必须可追溯 | 基础约束 |
| D13 | 外部渠道能力按账号验证 | 平台审核与账号差异 | 基础约束 |
| D14 | 本地首批使用 PGlite + Drizzle，单进程持久任务 | 不使用当前电脑共享数据库即可运行演练 | 仅本地；正式 PostgreSQL、OIDC、Redis/Worker 仍按原方案推进 |
| D15 | AI 根据可采购、支持代发的大陆供应商判断商品与国家 | 用户明确平台承担分销、供货方发货 | 已实现引用约束的发现流程；真实账号与货源待验证 |
| D16 | 管理员配置 LLM、搜索、额度及账号，运营执行和审阅 | 用户要求权责分离 | 已实现服务端权限；当前仅本机应用层隔离 |
| D17 | 真实服务不可用时阻塞，人工文案入口明确标识；真实编码视频 | 用户要求实际自动化 | 已实现持久步骤、真实 HTTP 适配器与 FFmpeg；外发与交易未接入 |

## 2. 待定业务信息

首销国家与商品由 AI 根据供应商和发货证据形成候选，不再要求用户预先选择。平台分销、供应商支持发货已确认。实际供货商、报价与客单价、经营/收款主体、支付物流、渠道账号、预算与亏损上限、佣金层级仍待业务验证。

样稿使用“折叠桌面支架”、英语/美元及匿名示例供应商，只用于验证布局与计算；不代表产品推荐、已发现工厂或已完成市场调研。

## 3. 官方资料

| 来源 | 用途 | 证据范围 |
|---|---|---|
| [客隆体 AI 官网](https://consumerclone.com/) | 理解参考产品的营销/客户经营方向 | 官网声明，未做产品功能实测 |
| [TikTok 内容分享指南](https://developers.tiktok.com/docs/en/content-sharing-guidelines) | 判断内部工具直发限制及所需用户步骤 | 具体账号与应用是否获批仍需验证 |
| [Shopify 中国商户支付设置](https://help.shopify.com/en/manual/intro-to-shopify/initial-setup/sell-in-china/set_up_payments) | 说明大陆商户需核实第三方网关路径 | 不证明我们的主体已开通 |
| [Shopify webhooks](https://shopify.dev/docs/apps/build/webhooks) | 回调验签、去重、乱序/漏送与对账 | 具体 API 版本实现前复核 |
| [Shopify mutation 幂等](https://shopify.dev/docs/api/usage/implementing-idempotency) | 不能假设所有外部动作都支持幂等 | 按 mutation 与 API 版本确认 |
| [Node.js 发布状态](https://nodejs.org/en/about/previous-releases) | 选择 24 LTS 作为运行时基线 | 首批工程在本机 Node.js 24.19.0 验证，工程要求 24.x |
| [Next.js 安装与 App Router](https://nextjs.org/docs/app/getting-started/installation) | Web 技术选型 | 兼容版本以实际工程锁定为准 |
| [BullMQ 幂等任务](https://docs.bullmq.io/patterns/idempotent-jobs) | 重试需要业务幂等 | 不保证跨外部系统 exactly-once |
| [PostgreSQL RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html) | 工作区隔离及角色绕过限制 | 必须用实际运行角色做隔离测试 |

本文档是来源索引，不构成某个国家/品类的法律或税务结论。具体市场选定后再核对适用要求，保存到对应商品市场档案。

## 4. 本轮工作区状态

开始时工作目录为空，没有 Git 仓库或 AGENTS.md。现已建立 docs、apps、packages、scripts、tests，完成本地首批工程与生产构建验证；仍未初始化 Git 或部署到公网。未启用真实 AI、商业账号、支付、采购、外发或发布；无新增付费服务。

历史方案检查见 [方案报告](../reports/2026-09-06-plan-review.md)，首批工程结果见 [首批工程验收](../reports/2026-09-06-phase01-implementation.md)。最新自动化代码、权限、验证和边界见 [自动化方案](09-automation-and-access.md) 与 [当前验收](../reports/2026-09-06-automation-implementation.md)。原完整商业架构继续作为目标。
