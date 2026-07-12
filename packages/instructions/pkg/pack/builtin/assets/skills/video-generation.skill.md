---
name: video-generation
title: 视频生成与交付
description: 用户要求生成视频、动画、动态画面，把图片或分镜转成视频，为角色、场景、道具、镜头出片，做首尾帧衔接或批量出片时使用；负责模型选择、参数确认、首帧参考、提示词优化、后台任务轮询、交付和文档回写
---
# 视频生成与交付

## 核心边界

- 使用 MediaGo Drama MCP 完成视频生成，不要临时编写脚本或直接调用供应商接口。
- 只负责目标确认、模型选择、参数确认、提交、轮询、交付和回写；模型路由校验、供应商调用、视频下载与资产落库交给服务端。
- 不要编造 `routeId`、`model`、参数名、参数值、文档 ID、section ID、资产 ID 或任务 ID。
- 用户取消选择或表单、明确拒绝生成，或等待确认最终超时时，立即停止；不要擅自采用默认值继续生成。
- 视频生成通常是分钟级的后台异步任务，不要在对话里阻塞等待整段生成完成；提交后设置好通知、告知任务 ID 和后台状态，再结束当前回合。

## 标准流程

严格按以下顺序执行；用户已经明确提供的信息不要重复询问。目标是含多个镜头组的分镜文档时，改走下面的“为分镜批量生成视频”一节（其第 2、3 步与本流程共用）。

### 1. 锁定目标

- 明确要生成视频的主体、用途和目标资源。常见目标：为某个分镜镜头出片、让角色或场景动起来、把已有定稿图转成视频。角色存在多个时期/形态、同名资源有多个 section，或多个资源都匹配时，调用 `ask_user_selection` 让用户选择具体资源。
- 目标选项使用面向用户的阶段或资源标题；已有定稿图或首帧图时作为选项 `imageUrl`。不要在标签或描述里暴露 section ID、资产 ID 等内部字段。
- 只有唯一匹配，或用户已经明确指定目标文档和 section 时，才跳过目标选择。
- 为项目资源生成时，读取目标二级标题前已有的 `<!-- section-id: ... -->`；保留该值，不要自行计算或伪造。

### 2. 获取模型目录并确定模型

- 调用 `list_generation_models`，固定传入 `kind: "video"`。
- 只使用返回目录中 `configured: true` 的视频路由。视频路由默认都需要各自供应商凭证；没有已配置路由时，提示用户前往设置配置供应商并停止。
- 目录和路由配置可能随时间变化：在准备提交前的同一回合内获取或刷新一次目录，不要复用更早轮次缓存的目录或 `routeId`。只把当前 `configured: true` 的路由用于提交；之前选定的路由已变为未配置时，重新走目录与参数选择，不要硬提交已失效的 `routeId`。
- 视频目录不返回 `stylePresets`（风格 preset 仅图片提供）。视频的画风、镜头语言和氛围来自 `prompt` 本身、提示词包或首帧参考图，不要去查找或等待风格 preset。
- 用户已经明确指定模型或画风时，直接遵循，不要重复询问。确认阶段不要调用 `generate_media` 试生成。
- 记录 `list_generation_models` 返回的 `preferences.routeIds` 与 `preferences.routeParams`，作为下一步参数默认值来源。

### 3. 一张表单确认全部生成参数

模型确定后调用一次 `ask_user_form`，标题使用“生成参数”。不要逐个参数追问，也不要用打包方案单选卡代替表单。

- 模型、比例、分辨率、时长等使用一个 `{id: "generation", type: "generation_params", kind: "video", label: "模型与参数"}` 字段，**必须带 `kind: "video"`**（决定客户端渲染视频模型目录；缺省会回落成图片模型），不提供 `options`。默认 `{routeId, params}` 从 `list_generation_models(kind: "video")` 返回的 `configured: true` 视频路由里选一个，不要用跨类型、偏图片的 `preferences.routeIds`；`params` 按该路由的参数 schema 预填。
- 视频参数按最终候选路由返回的参数 schema 和组合约束预填，例如比例、分辨率（如 480p/720p/1080p/4K）、时长、是否生成音频；不要猜测 `duration`、`resolution`、`size` 等参数名。没有兼容组合时，在提交前说明冲突并让用户选择可用替代值。
- 用户要求以某张图作为视频首帧、保持角色或场景一致、从上一镜尾帧衔接，或把已有定稿图转成视频时，增加一个 `{type: "images", label: "首帧/参考图", max: 3}` 字段。目标资源已有定稿图或上一镜尾帧时，用其资产 ID 填入 `default`，用户可以上传、移除或替换。视频参考图语义是“首帧或画面参考”，与图片的风格参考不同。
- 目标 section 正文中的普通 Markdown 图片不会自动成为参考图；只有 @mention 引用会被自动抽取。需要沿用 section 内图片作为首帧时，必须把对应资产 ID 明确放入参考图字段默认值或后续 `referenceAssetIds`。
- 路由与提示词包支持提示词优化时，可增加一个 `type: "prompt_optimization"` 字段，不提供 `options`，并把选定提示词包预填为 `{enabled, routeId, referenceName, referencePrompt}`。
- `ask_user_form` 返回 timeout 时，使用 `await_user_selection` 继续等待同一个 `selectionId`，每轮不超过 90 秒，最多循环 3-5 轮；不要重建表单。返回 cancelled 或持续超时时停止生成。

表单提交后：

- 从 `values.generation` 原样取得 `{routeId, label, params}`；调用生成时不要替换路由，也不要增加、删除或改写其中参数。
- 从 `prompt_optimization` 字段读取优化设置；只有 `enabled: true` 时才构造 `promptOptimization`，并原样传递其中的 `routeId`、`referenceName` 和 `referencePrompt`。
- 从参考图字段取得资产 ID 数组，填入 `referenceAssetIds`。
- 若存在首帧/参考图，先用模型目录核对所选路由支持参考图及数量上限。路由不支持或数量超限时，不要静默丢弃参考图，也不要提交生成；说明冲突并重新用一张生成参数表单让用户选择兼容路由或移除多余参考图。

### 4. 构造并提交生成

只有一个目标资源时调用 `generate_media`。多个独立镜头或资源使用同一套已确认模型与参数时，调用一次
`generate_media_batch`，不要在 Agent 内循环调用 `generate_media`；批次 `items` 中每个目标放一个请求，
`id` 使用能稳定对应目标资源的唯一值，`request` 字段与单次 `generate_media` 参数一致。

每个单次请求或批次子请求至少传入：

- `kind: "video"`
- 表单返回的 `routeId`
- 表单返回的完整 `params`
- 非空 `prompt`
- 可读的 `assetTitle`

按需追加：

- 将首帧/参考图资产 ID 填入 `referenceAssetIds`。
- 启用提示词优化时传入 `promptOptimization`。返回 `optimizedPrompt` 后，将它视为实际生成提示词，并在最终结果中向用户展示。
- 为角色、场景、道具或分镜资源生成时必须传该子项自己的 `documentContext`：`documentId` 使用目标文档 ID，`sectionId` 使用目标资源的稳定 section ID；无需自报 `resourceType`，服务端会按文档类型推断。
- 为项目资源生成时，每个子请求都同时传自己的 `notificationTarget`，指向目标文档及章节，以便任务在当前回合结束后仍能发送完成通知。
- 多个镜头必须是多个 batch item；不要用参数里的时长或数量代替多个镜头子项。

### 5. 等待任务完成（视频通常后台异步）

- `generate_media` 返回的 `id` 就是 `taskId`。`generate_media_batch` 返回批次 `id`，并在每个成功子项中返回独立 `taskId`；单项错误不会取消同批其他任务。
- 视频生成通常耗时较长（分钟级）。状态为 queued、submitting、submitted 或 running 时任务在后台运行：确认已设置 `notificationTarget`，把任务 ID 和后台状态告知用户后结束当前回合，不要长时间阻塞轮询。
- 需要在同一回合内跟进时，对仍在进行的任务使用各自 `taskId` 调用 `poll_generation_task`，必要时用 `get_generation_task` 读取最新状态和资产；批次可用 `list_generation_tasks(batchId: ...)` 汇总查询。
- 轮询期间保持安静，不要每轮输出状态。状态完成、失败或不可重试时停止轮询。
- 任务失败时展示面向用户的错误信息；仅在任务明确标记可重试且重试仍符合用户原始参数时，才调用 `retry_generation_task`。不要暗中切换模型或参数。

### 6. 交付并回写

- 视频任务通常每个 `taskId` 只产出一条视频，直接使用该资产。确有多条候选时才调用 `ask_user_selection`，每项以可读标签（“方案一”“方案二”等）呈现，不要展示 `slotIndex`。
- 用户选定后，用对应资产的真实 `slotIndex` 调用 `select_generation_asset(taskId, slotIndex)`。生成时未带 `documentContext`、但需要把结果定稿到项目资源时，才补传 `resourceType`（`character`、`scene`、`prop` 或 `storyboard`）。
- 需要衔接下一镜时，若本次开启了返回尾帧（`returnLastFrame`），把返回的尾帧资产作为下一镜的首帧参考。
- 需要写入文档时，将选中视频资产以产品支持的资源引用或 Markdown 插入目标章节；不要把临时远程供应商 URL 当成本地落库地址。
- 用户取消交付时，不要替用户选择；保留生成历史并说明尚未定稿。

## 为分镜批量生成视频

目标是含多个镜头组的分镜文档（正文用 `## 第 0N 组` 二级标题分组）时按本节执行。本节替代标准流程的第 1、4、5、6 步；第 2、3 步（模型目录与生成参数表单）仍然只做一次、整批共用。

### B1. 读取并枚举镜头组（只读一次）

- 直接读取目标分镜 Markdown **一次**，按 `## 第 0N 组` 二级标题枚举全部镜头组，记录每组的标题、面向用户的摘要，以及其上方的 `<!-- section-id: ... -->`。不要反复重读同一个文件，也不要每组各读一次。
- 无法从正文稳定切分镜头组时，如实说明并请用户确认分组或范围，不要臆造分组或伪造 section ID。

### B2. 确定生成范围（镜头组多时用表单，不要逐组选择卡）

- 镜头组超过 8 个时，不要用 `ask_user_selection` 逐组罗列（选择卡只适合少量选项，几十组会展示不全）。改用一次 `ask_user_form`：
  - 一个范围字段（`text` 或 `select`），让用户填“全部 / 组号列表 / 范围”，例如 `全部` 或 `1-10, 28, 31`；在字段说明里给出可选组号区间。
  - 一个 `toggle` 字段“先试片一组”，默认开启，用于先确认风格、人物一致性和动作强度，再批量。
- 镜头组不超过 8 个时，可用 `ask_user_selection` 列出各组供选择，并允许自定义输入。
- 解析用户输入得到目标镜头组集合；组号越界或无法解析时，说明并重新征询，不要默默丢弃或猜测。

### B3. 试片确认（“先试片一组”开启时）

- 从目标集合里挑一个代表镜头（优先用户点名的组，否则取集合中第一组），按标准流程第 4 步用 `generate_media` 单独生成一条，交付后请用户确认风格、人物一致性和动作强度。
- 用户确认满意后再批量生成其余镜头组；用户要求调整时，回到第 3 步只改参数或提示词后重试试片，不要擅自换模型。
- 用户在范围表单里关闭“先试片”或明确要求直接全部时，跳过试片，直接进入批量提交。

### B4. 批量提交（generate_media_batch，一组一个 item）

- 对目标集合调用 `generate_media_batch`，**不要在 Agent 内循环调用 `generate_media`**。已试片并采用的那个代表镜头不要重复生成。单个批次最多 50 个子项；目标镜头超过 50 个时，拆成多个不超过 50 项的批次分别提交，不要把超限集合塞进一次调用。
- `items` 中每个镜头组一个请求：
  - `id` 使用能稳定对应该镜头组的唯一值（例如其 section ID 或组号），便于回写时对号入座。
  - `request` 与单次 `generate_media` 一致：`kind: "video"`、表单返回的 `routeId` 与完整 `params`、非空 `prompt`、可读 `assetTitle`。
  - `prompt` 取该镜头组的画面与动作描述，并沿用整批统一的风格与一致性要求（人物、场景、镜头语言）。
  - `documentContext` 用该镜头组自己的 `{documentId, sectionId}`；`notificationTarget` 指向该镜头组，确保回合结束后仍能逐条通知。
  - 需要首帧衔接时，把该镜头的定稿关键帧或上一镜尾帧资产 ID 填入该子项的 `referenceAssetIds`。

### B5. 后台异步交付与逐组回写

- 批量视频必然长耗时：确认每个子项都带了 `notificationTarget` 后，回报批次 `id` 和各镜头 `taskId` 及后台状态，结束当前回合，不要阻塞轮询。
- 需要汇总时用 `list_generation_tasks(batchId: ...)`；对未完成子任务用各自 `taskId` 调 `poll_generation_task`。
- 各镜头完成后按其 `documentContext` 回写到对应 `## 第 0N 组` 章节；带 `returnLastFrame` 时可把尾帧作为下一镜首帧参考实现连拍。
- 部分子任务失败不影响其他：对失败镜头按标准流程第 5 步处理（展示错误、必要时按原参数重试），不要因个别失败中断整批交付。

## 最终回复

只总结实际结果：任务状态、定稿资产名、视频地址、落库或目标文档位置，启用优化时的 `optimizedPrompt`，以及是否有可用尾帧供下一镜衔接。批量任务给出批次 `id`、成功/失败镜头数和各自去向即可，不要复述中间选择、轮询和重试过程。
