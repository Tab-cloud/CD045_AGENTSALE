# 店铺授权与经营对账实现报告

日期：2026-09-06。版本：v0.8。

## 交付结果

- TikTok Shop 卖家 OAuth：十分钟一次性 state、后端 Token 交换、卖家主体校验、店铺读取、Shop Cipher 保存和 Refresh Token 自动更新。
- Temu US/EU 回调授权：回调 code 交换 Token，保存 Mall ID、实际 API scope、事件订阅与到期时间；Global 跨境店继续使用官方手工授权方式。
- 管理员门户新增平台连接按钮、Service ID、授权地区和授权范围展示；运营门户不接触 Token。
- Agent 的 `/sync` 和自动周期新增财务、退货退款与售后数据同步。
- 新增 TikTok Shop 商品创建、库存更新、退货审批/拒绝接口，以及 Temu 商品创建、库存更新接口。
- 新增通用经营记录表，持久保存授权元数据、财务结算单和售后单。

## 安全与恢复

- OAuth state 只保存 SHA-256 摘要，十分钟过期且只能消费一次。
- Access Token 与 Refresh Token 继续由本机系统账号加密保护，不进入数据库、浏览器响应、日志或 Git。
- Token 刷新只在接近到期时执行；平台调用仍受真实验证和 scope 限制。
- 商品创建使用幂等键。外部结果未知时沿用连接器事件对账规则，禁止盲目重试。

## 当前边界

当前没有 TikTok Shop 或 Temu 卖家应用凭据，因此协议已通过隔离模拟验证，但生产店铺仍显示未连接。首次接入仍需在平台开发者后台登记本机或生产回调地址，并由店铺所有者完成一次授权。

TikTok Content Posting 使用另一套用户授权，Temu Global 跨境卖家授权方式与 US/EU 本地店不同；这些入口不会混用。商品写入接口不会自动猜测类目合规字段，只有类目、认证、尺寸重量和素材权利资料齐全后才应由 Agent 提交。

## 验证

- TypeScript：运营端与管理员端通过。
- Vitest：57 项通过，新增 OAuth state 重放拒绝、TikTok Token 更新、Shop Cipher 保存、Temu scope 保存、财务售后同步和商品创建幂等测试。
- 运营端、管理员端生产构建通过；两个入口返回 200。
- 伪造 OAuth state 被拒绝并安全重定向到管理员门户，响应中不包含凭据。
