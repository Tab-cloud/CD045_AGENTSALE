# 聆风内置技能包

此目录是聆风应用的业务技能资源，不会安装到用户的 Codex / Claude 全局目录。

## 固定来源

- `copywriting`、`copy-editing`、`ad-creative`、`social`、`video`：Corey Haines 的 [marketingskills](https://github.com/coreyhaines31/marketingskills)，固定提交 `5b2c0007766c6a1cf1d53fd8fc73e979e0821022`，MIT。
- `ffmpeg`：Muhammad Dadu 的 [ffmpeg-skill](https://github.com/muhammaddadu/ffmpeg-skill)，固定提交 `f6482b65e7cc4f25d4b368e24f419eec945744ca`，MIT。

`vendor/<id>/` 保存未经修改的上游 SKILL.md、Markdown 参考文档和许可证。`catalog.json` 保存中文展示、用途、来源、固定提交、许可证、实际加载的参考文档清单、指令包和 SHA-256。未内置上游脚本或依赖，也不会运行技能中的命令。指令包包含主文件并在 60,000 字符预算内附带完整参考文件；超出预算的参考文件保留在 vendor，但不传给模型。只加载用户选定的技能。

## 应用适配

- Rust 验证技能选择、保存版本、编排模型/图片/视频任务；Web 按相同版本查找技能方法，添加应用权限和输出约束后交给管理员配置的模型。
- 电商可选文案类技能，不改变原图片数量、事实约束或调用预算。
- 文案类技能交付草稿、脚本或策划，不执行原文中的安装、第三方登录、发布、抓取和付款操作。
- FFmpeg 技能只接入有类型约束的截取、画幅适配、静音和 MP4 导出；Web 生成固定参数列表，不执行模型输出的 shell、滤镜字符串或文件路径。
- 不声称完整支持上游全部能力。字幕识别、多轨编辑、视频理解、任意 GitHub 包导入及自动升级尚未提供。

## 更新

维护者在评估许可证和内容后修改 `apps/agent/scripts/vendor-builtin-skills.py` 的固定提交及白名单，再执行脚本并检查生成差异。该脚本仅下载 Markdown 和 LICENSE，不执行第三方代码。版本随应用和服务同步发布；客户端提交的技能 ID、commit 和指纹需与服务匹配。

FFmpeg 引擎由服务器运营方安装，未打包进此技能包。服务端默认从 PATH 寻找 `ffmpeg` / `ffprobe`，可用 `LINGFENG_FFMPEG_PATH` / `LINGFENG_FFPROBE_PATH` 指定运营方管理的路径。引擎自身的发行许可证与上述技能文本许可证分别适用。
