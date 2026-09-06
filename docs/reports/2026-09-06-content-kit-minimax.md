# 商品内容包与 MiniMax v0.3 验收

日期：2026-09-06。已补齐商品海报、商品详情、配音和动态图生视频流程，并使用用户授权的 Token Plan 完成一次真实内容包生成。接口成功不代表商业素材已经审阅或可直接发布。

## 实现结果

| 能力 | 当前交付 |
|---|---|
| 商品内容 | 模型生成标题、简介、详情、卖点、规格、SEO、待补资料；可编辑，HTML/TXT/JSON 导出 |
| 海报 | 使用上传原图与生成文案，本机排版输出三种 PNG 尺寸；未接生图或商品重绘 |
| 配音 | MiniMax 同步语音真实生成 MP3，检查时长与解码，混入成片 |
| 视频 | 海螺首帧图生视频、持久任务号、后台查询与下载、竖屏适配及音轨合成 |
| 管理控制台 | 文本协议/模型配置，独立多媒体密钥/音色/模型/额度；v0.4 已迁移到独立管理门户 |
| 工作流 | 已有商品可独立生成待核实草稿；供货复核流程继续要求大陆、代发和目标国配送证据 |
| 恢复 | 下载失败可继续查询原任务；提交结果未知禁止自动重发，支持填写原任务号恢复 |

## 真实服务证据

使用地址 `https://api.minimaxi.com/v1`。文本 `MiniMax-M2.7`，语音 `speech-2.8-hd` / `English_Trustworthy_Man`，视频 `MiniMax-Hailuo-2.3`。

- 文本连接与严格结构校验成功：[连接记录](artifacts/content-v0.3/live-minimax-text.json)。
- 内容流程 `723fa373-8040-4848-a78f-a3854dcbd178`，8 个步骤全部完成，最终状态 `waiting_review`。
- 海螺任务 `438796671386104`，文件 `438779649241201`，服务商状态 `Success`。生成 POST 仅提交一次；下载受 TUN 地址映射拦截后继续原任务查询。
- 真实配音约 15.22 秒；6 秒动态原片合成为 16 秒、720×1280、H.264 / AAC 成片，尾帧延长保留完整配音。整段解码通过。
- 15 个交付文件通过认证下载，并逐个比对 SHA-256：[文件清单与流程记录](artifacts/content-v0.3/live/verification.json)、[媒体检查](artifacts/content-v0.3/live/media-check.json)。

主要产物：[成片](artifacts/content-v0.3/live/video.mp4)、[海螺原片](artifacts/content-v0.3/live/hailuo-source.mp4)、[配音](artifacts/content-v0.3/live/voiceover.mp3)、[方形海报](artifacts/content-v0.3/live/poster-square.png)、[竖版海报](artifacts/content-v0.3/live/poster-portrait.png)、[故事海报](artifacts/content-v0.3/live/poster-story.png)、[商品详情](artifacts/content-v0.3/live/product-description.html)、[结构化详情](artifacts/content-v0.3/live/product-listing.json)。

成片 SHA-256：`64c37f09864aeab92d766df32a3a10e19a1a2e6be1b47a3aab15c3e0f849c1f8`。

另一次真实供货研究识别了合成测试来源，没有选中供应商；供货复核流程因此阻塞内容步骤，错误为 `FULFILLMENT_EVIDENCE_REQUIRED`。此行为保留了来源门槛，未把测试数据当作真实供应商推荐：[研究记录](artifacts/content-v0.3/live-research-result.json)。

## 测试与界面验收

完整检查记录：[check.log](artifacts/content-v0.3/check.log)，包含类型检查、46 项测试和生产构建。协议自动化测试使用 HTTP 测试服务器、合成图片与测试音视频，和上述真实 MiniMax 调用分开记录。

覆盖模型 JSON 前言/代码围栏解析、严格结构校验、HTML 转义、来源校验、三尺寸海报、音频和视频解码、异步等待释放、预算不足不提交、未知提交不重发、原任务号恢复、密钥隐藏及网络映射范围。

浏览器实际操作验证了管理员 MiniMax 预设、内容包创建、海报与商品标题修改后重新生成、待审阅结果展示、三张海报完整加载（1080×1080 / 1080×1350 / 1080×1920）。在本机应用页播放真实视频，观察到播放时间推进至 8.07 秒，媒体就绪状态为 4、时长 16 秒；配音资源时长 15.22 秒。当前 624 像素宽视图无页面横向溢出。

验收中修复了播放器在仅有海螺原片时提前加载最终视频的问题：现在按最终文件名判断，并按文件哈希刷新播放器。生产构建重启后再次打开任务，1280 像素视图无页面横向溢出，16 秒成片就绪且播放状态为进行中。合成测试流程修改记录另存于 [fixture/verification.json](artifacts/content-v0.3/fixture/verification.json)，不标成真实模型证据。

## 配置与费用边界

此次真实密钥仅保存于隔离验收数据目录的 Windows DPAPI 密文配置，未写入源码、报告或导出素材，接口不返回明文。正常工作区未导入验收账号或启用该测试配置。

隔离环境：`http://127.0.0.1:3046`，数据目录 `%LOCALAPPDATA%/AgentSale/CD045_AgentSale-cd0898b7/qa-automation-20260906/`。正常环境使用端口 3045 和原有数据目录。查看本次内容可打开 [验收任务](http://127.0.0.1:3046/automation/jobs/723fa373-8040-4848-a78f-a3854dcbd178)。

测试管理员配置文本单次预留 5 美分、语音 5 美分、视频 50 美分、单日 100 美分，内容流程累计上限 80 美分。这些是调用预留限制，不是服务商实际消费、Token Plan 套餐结算或剩余额度查询结果。

本机代理将官方域名映射为 `198.18/15`。兼容仅针对固定 MiniMax HTTPS 主机以及实测文件检索返回的精确 CDN 主机 `public-cdn-video-data-algeng.oss-cn-wulanchabu.aliyuncs.com`，不放开全部阿里云域名；保留 TLS 主机验证、检查后固定 DNS 地址及无凭据下载。普通来源采集与真正内网仍受原规则约束。

## 尚未完成的商业能力

本次输入是明确标记的合成商品与示意图片。海螺将示意形状生成了更接近实物的外观，说明功能已实际调用，也说明外观一致性必须人工核对；不能用本次视频代替真实工厂样品验收。字幕是三段均分时间的 SRT，尚未逐词对齐语音，未自动烧录到动态成片。

未完成供应商签约、消息外发、海外平台自动发布、支付下单、订单物流与佣金结算。本批交付的是可操作、可恢复、可审阅的内容生产流程。

接口依据与配置说明见 [商品内容包与 MiniMax 集成](../plan/10-content-kit-and-minimax.md)。
