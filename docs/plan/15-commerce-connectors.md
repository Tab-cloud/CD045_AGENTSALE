# 自动化电商连接器与接口清单

更新时间：2026-09-06

## 目标

让经营 Agent 在管理员完成平台授权后，自动读取市场与订单、生成内容、发布、采购、发货、跟踪和处理售后。每个外部动作必须有幂等键、持久事件、明确结果和对账路径；未知结果不自动重发。

## 已实现接口

### TikTok Shop

- 官方 HMAC-SHA256 请求签名，Access Token 仅放在 `x-tts-access-token`。
- `GET /authorization/202309/shops`：验证卖家授权。
- `POST /order/202309/orders/search`：同步订单。
- `POST /product/202502/products/search`：按本地 SKU 查找渠道商品。
- `GET /analytics/202605/shop_products/performance`：读取近七日商品销量、曝光与 CTR，写入决策层市场快照。
- `POST /fulfillment/202309/orders/{order_id}/packages`：提交自发货包裹。
- TikTok Shop Webhook：使用原始请求体验签，以 `tts_notification_id` 去重。

### TikTok 内容发布

- `POST /v2/post/publish/creator_info/query/`：验证账号与可用发布选项。
- `POST /v2/post/publish/video/init/`：初始化 Direct Post。
- `PUT upload_url`：上传本地 MP4，限制上传域名为 TikTok 官方域名。
- `POST /v2/post/publish/status/fetch/`：查询发布状态。
- 默认仅自己可见，直接发布默认关闭；管理员启用后，Agent 才能提交。正式公开发布仍受 TikTok 应用审核、账号授权、内容同意和平台限流约束。

### Temu

- US、EU、Global 三个官方 OpenAPI Router。
- 官方 MD5 大写签名。
- `bg.open.accesstoken.info.get`：验证授权。
- `bg.order.list.v2.get`：同步订单。
- 订单按 `extCode` 与本地 SKU 聚合，写入决策层市场快照。
- `bg.logistics.shipment.v2.confirm`：确认发货。
- Webhook 使用签名校验和事件 ID 去重。

### AgentSale Bridge 协议

Bridge 用于适配不同的中国供应链、ERP、WMS、3PL、DAM 和客服系统。请求使用 Bearer Token、`Idempotency-Key` 与 `X-AgentSale-Protocol: 2026-09-06`。

| Bridge | 已实现操作 | 自动执行开关 |
| --- | --- | --- |
| Supplier | `POST /v1/health`、`POST /v1/purchase-orders` | 单独控制 |
| Asset | `POST /v1/health`、`POST /v1/assets/resolve` | 单独控制 |
| Logistics | `POST /v1/health`、`POST /v1/shipments` | 单独控制 |
| Customer | `POST /v1/health`、`POST /v1/cases/actions` | 单独控制 |

素材返回约定：`{"asset":{"name":"...","rights":"...","base64":"..."}}`。图片进入内容流程前仍执行格式、像素、大小、哈希和权利说明检查。

## 执行保障

- 凭据由独立管理员门户保存到系统账号保护区，运营端只能看到能力状态。
- 连接器必须真实验证，单纯保存配置不会变成“可用”。
- `commerce_orders` 保存渠道订单快照。
- `connector_events` 保存收件、执行、成功、失败和未知状态，唯一键防止重复发布与重复采购。
- `connector_state` 保存验证时间、同步时间和最近错误。
- Webhook 与轮询同时使用；Webhook 不是唯一数据来源。
- `/sync` 立即同步订单和市场数据；自动运行周期也会同步。
- 内容发布按“提交 → 状态查询 → 完成/失败”推进；已处理内容不会阻塞后续采购。
- 订单按“渠道订单 → 供应商采购 → 物流建单 → 渠道发货回传”推进；物流响应须返回渠道所需的 `channelFulfillment` 字段。
- 客服 Bridge 的退货、退款、消息和工单事件可通过 Webhook 进入队列，Agent 按平台与店铺策略自动提交处理动作。

## 仍需补充的接口

### P0：完整成交闭环

1. **OAuth 与令牌续期**：TikTok Shop、TikTok Content、Temu 的授权回调、刷新、撤销和多店铺绑定。目前支持保存已取得的 Token。
2. **商品创建与合规资料**：类目、属性、品牌、图片上传、重量尺寸、认证、仓库、运费模板、价格、库存、审核结果。不同品类字段不能从通用文案推断。
3. **支付与财务对账**：消费者支付由平台完成；系统还需同步付款状态、退款、手续费、结算、提现、汇率、税费和供应商付款结果。
4. **完整履约状态机**：On Hold、待发货、拆单/合单、面单、揽收、轨迹异常、签收、丢件和超时。
5. **退货退款**：资格判断、取消、退货地址、退货标签、部分退款、争议和结果回读。
6. **供应商适配器**：1688 或具体 ERP 的商品、报价、库存、样品、采购、取消、发货与售后接口。Bridge 已定义，仍需选择首家真实供应商系统。
7. **客户服务**：会话、消息、订单卡、物流卡、售后卡、敏感信息最小化和平台允许的自动回复规则。
8. **授权权限发现**：保存每家店铺实际获批的 API scope、事件订阅、过期时间与区域。Temu 的 Token 信息会返回这些字段，不能仅按“配置过 Token”推断权限。

### P1：增长与自动优化

1. TikTok Shop 视频、直播、商品卡和联盟达人分析。
2. TikTok Affiliate 选品、邀约、佣金、样品和推广链接。
3. Temu 商品广告、ROAS 预测、报表和价格建议。
4. 广告账户、预算、受众、素材审核、投放和转化归因。
5. A/B 实验、素材疲劳、价格实验、库存保护和自动止损。
6. 多语言翻译、当地单位、税务、关税、禁限售、商标和内容合规。
7. 邮件、WhatsApp 或平台站内信的供应商询价和客户跟进。
8. 经营告警、SLA、死信队列、人工接管入口和审计导出。

## 公开竞品研究边界

公开账号可用于分析视频频率、钩子、互动、商品卡和价格变化。竞品真实 GMV、退款、广告消耗和后台自动化无法从公开视频确认，只能作为低可信观察；授权店铺 API 数据才进入高可信自动决策。

## 官方依据

- TikTok Shop Developer Guide: https://partner.tiktokshop.com/docv2/page/tts-developer-guide
- TikTok Shop request signing: https://partner.tiktokshop.com/docv2/page/sign-your-api-request
- TikTok Shop webhooks: https://partner.tiktokshop.com/docv2/page/tts-webhooks-overview
- TikTok Shop product analytics: https://partner.tiktokshop.com/docv2/page/get-shop-product-performance-list-202605
- TikTok Content Posting API: https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post
- Temu endpoints: https://partner.temu.com/documentation?menu_code=38e79b35d2cb463d85619c1c786dd303&sub_menu_code=8311de2b2d434e4d805e88413ab815d8
- Temu signing: https://partner.temu.com/documentation?menu_code=38e79b35d2cb463d85619c1c786dd303&sub_menu_code=4a821c90d06442a09e061b0d4316fbf3
- Temu order list v2: https://partner.temu.com/documentation?sub_menu_code=554fd46b45ee49269cbdd6d4008a5dc1
- Temu seller authorization and callback: https://partner.temu.com/documentation?menu_code=fb16b05f7a904765aac4af3a24b87d4a
- TikTok Shop affiliate integration: https://partner.tiktokshop.com/docv2/page/affiliate-integration
