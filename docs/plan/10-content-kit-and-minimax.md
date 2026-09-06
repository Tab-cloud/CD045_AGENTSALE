# 商品内容包与 MiniMax 集成

版本：v0.3 / 2026-09-06。继承 v0.2 的管理员/运营分权、加密凭据、持久任务、工作区权限和调用预留。

## 产品入口

商品 → 启动自动化 →「生成商品内容包（已有商品资料）」直接制作待审阅草稿，不代表供货与市场已核实。另有「供货复核 → 完整商品内容包」，先核对代发与目的国证据，条件不满足时保留研究报告并阻塞后续商业内容。已有文案也可选择「已有图片与文案 → 海报与视频」；此入口不把人工文字标成模型生成。

| 产物 | 内容与输出 |
|---|---|
| 商品海报 | 1080×1080、1080×1350、1080×1920 PNG，保留上传商品图，自动排版标题、副标题和行动文案 |
| 电商商品详情 | 标题、简介、详情正文、卖点、来源明确的规格、SEO 标题/描述/关键词和待补资料；导出 HTML、TXT、JSON |
| 本机分镜视频 | 15 秒、720×1280、H.264 MP4 与 SRT |
| MiniMax 配音 | 根据配音文字调用同步语音接口，保存 MP3，并混入最终视频 |
| 海螺动态视频 | 根据所选商品图提交 6 秒 / 768P 图生视频；后台查询、下载、解码检查后适配为竖屏成片 |

配音比原片长时，延长最后一帧直到配音结束，最长 60 秒，不静默截断音频。字幕是三段平均时间分配，尚未实现逐词语音对齐。海螺最终视频带 AI 草稿标记；生成画面需要核对商品外观一致性。

海报使用本机排版，未接 MiniMax 生图或重绘商品。所有文字先经过结构校验，规格与详情保留来源 ID；未知规格放入待补资料。海报和视频文字超出布局容量时提示缩短，不静默裁切。

## 管理员配置

独立「管理控制台」提供 MiniMax 文本预设按钮：填写端点、模型、协议、JSON 输出方式和推理输出分离参数。用户可按实际账号修改地址与模型。当前真实 Token Plan 验证记录使用用户提供的 `https://api.minimaxi.com/v1` 与 `MiniMax-M2.7`；按钮采用官方当前文档的 `https://api.minimax.cn/v1` 和 `MiniMax-M3`，是否可用必须实际验证。

MiniMax 语音与海螺视频有独立的多媒体密钥、服务地址、语音模型、音色、视频模型及单次预留。两个密钥都由本机凭据保护层加密，接口只返回是否存在。模型密钥与多媒体密钥可以相同，也可以使用不同账号/密钥。更换各自端点会清除对应旧密钥。

默认语音模型为 `speech-2.8-hd`，音色 `English_Trustworthy_Man`，视频模型 `MiniMax-Hailuo-2.3`。管理员应按目标语言和账号权限调整。保存不是可用性验证；语音或视频权限以实际生成结果为准，文本验证不能代表所有模态都开通。

管理员单日预留与每个流程累计预留共同约束外部调用；修改内容后重新生成会继续占用原流程累计额度。额度不是准确的 Token Plan 账单，服务商套餐规则、剩余额度与按量计费仍以账号为准。

## 实际接口与恢复

- 文本：`POST /chat/completions`，MiniMax 模式设置 `reasoning_split=true`，使用提示词携带完整 JSON schema，服务端验证结果。M3 可显式关闭 thinking；M2.7 不发送关闭 thinking 参数。
- 配音：`POST /t2a_v2`，请求 MP3/hex，验证完整状态和业务错误码，再解析、检查时长并整段解码。
- 图生视频：`POST /video_generation`，原图规范化后作为 Base64 首帧发送，不暴露本机文件 URL。
- 任务状态：`GET /query/video_generation?task_id=…`，排队或生成中每 15 秒查询一次，等待期间释放工作器处理其他任务。
- 下载：`GET /files/retrieve?file_id=…` 后无凭据请求 HTTPS 下载 URL，检查文件与媒体内容，不将 API 密钥转发给下载站点。

视频调用先预留费用，再写入“正在提交”的持久标记，再发 POST。进程中断或返回结果未知时不能直接重发；运营可填写服务商后台核实的原任务号恢复查询。原任务失败后新生成需要新流程，取消本地流程不等于取消远程任务。文案修订会明确提醒重新调用可能产生费用。

本机 TUN 代理将官方域名映射到 198.18/15 时，仅对固定 MiniMax HTTPS 服务及允许的文件域名使用受限映射兼容，仍验证 TLS 主机身份；任意供应商 URL、真正内网地址和跨域重定向不获得该例外。

## 交付边界

本批完成内容生成与导出，不包含渠道自动发布、电商平台商品同步、支付、订单、物流及佣金结算。真实服务测试状态、生成文件与测试素材属性记录在 [v0.3 验收报告](../reports/2026-09-06-content-kit-minimax.md)。

## 官方依据（2026-09-06 复核）

- [MiniMax OpenAI 兼容文本](https://platform.minimaxi.com/docs/api-reference/text-openai-api)
- [同步语音合成](https://platform.minimaxi.com/docs/api-reference/speech-t2a-http)
- [系统音色](https://platform.minimaxi.com/docs/faq/system-voice-id)
- [图生视频](https://platform.minimaxi.com/docs/api-reference/video-generation-i2v)
- [视频状态查询](https://platform.minimaxi.com/docs/api-reference/video-generation-query)
- [文件检索](https://platform.minimaxi.com/docs/api-reference/file-management-retrieve)

以上说明接口用法，不代表某一 Token Plan 套餐已获得全部接口权限。
