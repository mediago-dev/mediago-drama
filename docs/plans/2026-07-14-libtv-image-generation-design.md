# LibTV 图片生成设计

## 背景

MediaGo Drama 已经通过 LibTV CLI 支持 Seedance 视频生成，但 LibTV provider 目前会拒绝所有非 `video` 请求。与此同时，通用生成目录、图片生成工作台、Agent 表单、批量生成、任务历史和素材缓存都已经支持 `image`，因此不需要增加新的页面、HTTP 接口或 MCP 工具。

本设计把 LibTV 图片能力接入现有“模型版本 → 供应商路由”体系。首期只开放用户提出的三个模型入口，并使用用户提供的 LibTV 1.0.2 模型清单作为产品别名依据。

## 决策摘要

采用“静态稳定路由 + 提交时能力校验”的方案：

- 目录中的 family、version 和 route ID 保持稳定，继续由 MediaGo 管理。
- LibTV CLI 的 `modelKey` 作为能力校验键，`modelName` 作为 `node create --set=model=...` 的实际值。
- 提交前查询当前 LibTV CLI 的 image 模型清单；只有找到预期 `modelKey` 才创建节点，并使用查询结果中的最新 `modelName`。
- 图片 route 设置 `Async=false`，复用现有图片后台执行、provider task handoff 和 worker 轮询链路。
- 首期固定生成 1 张图片，不在 UI 暴露 `n`。LibTV 的离散数量只允许 `1/2/4`，现有连续数字参数会错误允许 `3`；Seedream 额外固定 `sequential=0`，关闭模型自主组图。
- 首期若下载结果为 ZIP，返回明确的“不支持多图归档”错误，不把 ZIP 错判成视频；离散多图和安全解包留到后续版本。

## 首期模型映射

| MediaGo family/version | 稳定 route ID | LibTV modelKey | 当前 modelName | 参数摘要 | 最大参考图 |
| --- | --- | --- | --- | --- | --- |
| GPT Image / GPT Image 2 | `libtv.gpt-image-2` | `lib-image-2` | `Lib Image` | ratio、resolution、quality | 10 |
| Nano Banana / 3.1 Flash Image | `libtv.gemini-3.1-flash-image-preview` | `nebula-2-flash` | `Lib Navo 2` | ratio、quality（分辨率） | 7 |
| Seedream / Seedream 5.0 Lite | `libtv.seedream-5-lite` | `seedream-5` | `Seedream 5.0 Lite` | ratio、quality（分辨率） | 6 |

这是一层显式产品别名：界面仍按现有 GPT Image、Nano Banana、Seedream 家族组织；LibTV provider 内部使用真实 CLI 名称。未来若产品确认要开放 `Lib Navo Pro`、`Lib Navo` 或其他 Seedream 版本，应新增独立 version/route，而不是悄悄替换上述路由的语义。

## 方案比较

### 方案 A：静态路由，直接写死 modelName

改动最小，但 `modelName` 改名、账号无权访问或自定义 CLI 版本不兼容时，只会在 `node create` 阶段返回底层错误。稳定性不足。

### 方案 B：完全动态生成目录

每次读取 `/generation/models` 时运行 `libtv model search` 并动态创建 family/version/route。它能自动跟随 LibTV，但会破坏当前静态 `FindRoute`、任务 ID 解析、偏好持久化和离线 fallback catalog，复杂度明显超出需求。

### 方案 C：静态路由 + 提交时能力校验（采用）

route ID、偏好和历史记录保持稳定；provider 用 `modelKey` 查找当前账号可见模型，并解析最新 `modelName`。目录仍由现有体系驱动，模型缺失时可返回明确错误。它兼顾兼容性和实现范围。

## 架构与数据流

```text
图片工作台 / Agent / 批量生成
  -> POST generation message (kind=image, routeId=libtv.*)
  -> GenerationService 校验登录和路由
  -> 立即持久化本地 image task（submitted）
  -> completeSubmittedGeneration 后台执行
       -> LibTV provider 校验 modelKey
       -> 创建或复用 LibTV project
       -> 物化并校验图片参考素材
       -> upload reference nodes
       -> node create --type=image --run
       -> 返回 route:project:node provider task ID
  -> handOffPendingGeneration 保存 provider task ID
  -> generation worker 调用 provider.Get
  -> libtv download --node=...
  -> image Asset -> MediaGo 媒体缓存 -> 任务完成
```

不新增 HTTP、MCP 或 Agent 契约。`list_generation_models`、`generate_media`、`poll_generation_task` 继续消费同一 catalog 和 GenerationService。

## Catalog 与参数

新增 `AdapterLibTVCLIImage = "libtv.cli.image"`，三条路由分别挂到现有 `gpt-image`、`nano-banana`、`seedream` family/version。路由都满足：

- `Provider: libtv`
- `Kind: image`
- `Async: false`
- `SupportsReferenceURLs: true`
- `AuthKeys: [libtv]`
- 价格单位为 `external`

新增 LibTV 专用参数构造器，不复用 OpenAI、Gemini 或即梦的 provider 参数：

- 公共 canonical 参数：`aspectRatio`、`resolution`。
- Lib Image 额外暴露 `quality=low|medium|high`，默认 `medium`。
- Lib Image 翻译：`aspectRatio -> ratio`、`resolution -> resolution`、`quality -> quality`。
- Lib Navo 2 / Seedream 翻译：`aspectRatio -> ratio`、`resolution -> quality`。
- Lib Navo 2 在 MediaGo 中继续使用统一的 canonical 比例值 `adaptive`，提交给 LibTV CLI 时再翻译为其 schema 使用的 `auto`。
- provider 始终补 `count=1`。
- Seedream 路由通过 vendor const 固定补 `sequential=0`，不在 UI 暴露该开关。
- 有参考图时补 `modeType=image2image`；无参考图时不传 modeType。

比例和分辨率只开放 CLI schema 与 MediaGo 现有 canonical registry 的交集，不使用其他供应商的组合表猜测能力。Lib Image 的 `1:2`、`2:1` 首期暂不开放，避免为单一供应商扩大全局 canonical 契约。

## Provider 行为

`libtv.Provider.Generate` 继续先解析并校验 route，再按 kind 分支构造参数：

- `video` 路径保持现状，包括 `duration`、`enableSound`、`mixed2video`。
- `image` 路径只接受图片参考素材，拒绝 audio/video，并只透传 route 允许的图片参数；引用类型校验必须早于自动创建 LibTV project，避免无效请求产生供应商侧副作用。
- provider 根据 route ID 找到预期 `modelKey`，执行 `model search --type=image` 并解析 JSON；命中后使用返回的 `modelName`。
- 找不到模型时，错误明确说明 route、modelKey、CLI 版本/账号可能不兼容。
- `node create` 使用参数数组调用，不经过 shell 拼接。
- 单图 PNG/JPEG/WebP/GIF 继续转换为 Base64 `generation.Asset{Kind:image}`。
- `application/zip` 不再落入 video fallback，而是返回受支持范围错误。

项目绑定、自动建项目、上传重试、下载 pending 判断和 task ID 编码全部复用现有实现。

## 任务生命周期

LibTV 节点执行在供应商侧是异步的，但 route 的 `Async` 必须为 `false`。在当前服务端中：

- `KindImage && !route.Async` 会走 `ShouldRunGenerationInBackground`。
- 后台 `completeSubmittedGeneration` 调用 provider。
- provider 返回无资产的 active response 后，`handOffPendingGeneration` 保存 provider task ID。
- worker 再调用 `provider.Get` 直到完成或超过图片后台时限。

若设为 `Async=true`，会绕过这条成熟的图片后台入口，并让本地任务 ID、状态文案和 handoff 行为与其他图片 provider 不一致。

同时修正两个通用问题：

- 图片超时文案从“即梦生成超时”改成供应商无关的“图片生成超时”。
- 通用结果查询在已有 task 时使用 `storedTask.Kind`，避免 LibTV 图片结果被 fallback 成 video。

## 前端体验

不增加 LibTV 专用页面。服务端 catalog 返回三条 configured route 后，以下入口自动获得 LibTV：

- 创作工具箱图片生成
- 项目/文档图片生成弹窗
- 批量生成设置
- Agent `generation_params` 表单

前端只补 fallback catalog parity、参数 fixture、参考素材测试和设置缓存刷新。`libtv.cli.image` 使用默认 image 参考策略，只允许图片。

LibTV 登录、登录确认、轮询发现登录完成、保存或清除凭据后，需要同时失效：

- `generationModelsKey`
- Agent runtime config key

这样用户完成登录后无需刷新页面即可看到或隐藏 LibTV 路由。

## 错误处理

- 未登录：沿用 route configured 校验，返回 503 和 LibTV 配置提示。
- 模型不可见：返回“当前 LibTV CLI/账号未提供 `<modelKey>`”并保留底层查询摘要。
- 参考素材不是图片：在上传前返回参数错误。
- CLI 命令失败：沿用 `commandError`，保留安全的 CLI 输出。
- 下载仍 pending：返回 active response，交给 worker 后续轮询。
- 下载为 ZIP：首期明确失败，提示当前仅支持单图；绝不把 ZIP 标成 video。
- 超过后台图片时限：任务落为 failed，可由现有重试入口重新提交。

## 测试与验收

自动化测试覆盖：

- 三条 catalog 路由及参数翻译。
- modelKey 到实际 modelName 的能力解析。
- 文生图、图片参考、非图片参考拒绝。
- `--type=image`、`count=1`、Seedream `sequential=0`、`modeType=image2image` 参数。
- pending handoff、worker 轮询、图片资产缓存。
- PNG/JPEG/WebP、ZIP 错误和视频路径回归。
- 前端目录选择、参考素材、提交 payload 和登录后缓存刷新。
- MCP/Agent 继续通过统一 catalog 发现路由。

人工验收至少在 Windows x64 登录 LibTV 后完成：三种模型各生成一张纯文本图片；三种模型各使用一张参考图；刷新/重启后任务能继续完成；清除登录后 LibTV 路由消失。

## 非目标

首期不做：

- Lib Navo / Lib Navo Pro 和更多 Seedream 版本。
- `1/2/4` 离散多图数量选择。
- Seedream 自主组图开关。
- 为 Lib Image 新增全局 `1:2`、`2:1` canonical 比例。
- ZIP 多图安全解包。
- 动态创建新的 family/version/route。
- LibTV 专用生成页面或新的 MCP 工具。
