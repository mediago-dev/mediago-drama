---
name: image-generation
title: 图片生成与选片
description: 用户要求生成、配图、画图、重绘、修改、批量制作图片，或为角色、场景、道具、分镜生成视觉资产时使用；负责模型与风格选择、参数确认、参考图、提示词优化、任务轮询、选片和文档回写
---
# 图片生成与选片

## 核心边界

- 使用 MediaGo Drama MCP 完成图片生成，不要临时编写脚本或直接调用供应商接口。
- 只负责目标确认、模型选择、参数确认、提交、轮询、选片和回写；模型路由校验、供应商调用、图片下载与资产落库交给服务端。
- 不要编造 `routeId`、`model`、参数名、参数值、文档 ID、section ID、资产 ID 或任务 ID。
- 用户取消选择或表单、明确拒绝生成，或等待确认最终超时时，立即停止；不要擅自采用默认值继续生成。

## 标准流程

严格按以下顺序执行；用户已经明确提供的信息不要重复询问。

### 1. 锁定目标

- 明确要生成的主体、用途和目标资源。角色存在多个时期/形态、同名资源有多个 section，或多个资源都匹配时，调用 `ask_user_selection` 让用户选择具体资源。
- 目标选项使用面向用户的阶段或资源标题；已有定稿图时作为选项 `imageUrl`。不要在标签或描述里暴露 section ID、资产 ID 等内部字段。
- 只有唯一匹配，或用户已经明确指定目标文档和 section 时，才跳过目标选择。
- 为项目资源生成时，读取目标二级标题前已有的 `<!-- section-id: ... -->`；保留该值，不要自行计算或伪造。

### 2. 获取模型目录并确定风格

- 调用 `list_generation_models`，固定传入 `kind: "image"`。
- 只使用返回目录中 `configured: true` 的图片路由。没有已配置路由时，提示用户前往设置配置供应商并停止。
- 从返回的 `stylePresets` 推荐与需求匹配的风格。用户未明确风格时，用 `ask_user_selection` 展示少量候选；有 `previewUrl` 时作为选项 `imageUrl`，没有时使用纯文本选项。
- 用户已经明确指定风格时，匹配对应 preset 或直接遵循其描述，不要重复询问。推荐阶段不要调用 `generate_media` 试生成。
- 用户选定 preset 后，保存其 `promptSuffix`、`params` 和可选提示词包信息，供生成请求使用。

### 3. 一张表单确认全部生成参数

风格确定后调用一次 `ask_user_form`，标题使用“生成参数”。不要逐个参数追问，也不要用打包方案单选卡代替表单。

- 模型、比例、分辨率和张数使用一个 `{id: "generation", type: "generation_params", label: "模型与参数"}` 字段，不提供 `options`。先用 `list_generation_models` 返回的 `preferences.routeIds` 与 `preferences.routeParams` 构造 `{routeId, params}` 默认值，再把所选风格 preset 的 `routeId` 和非冲突 `params` 合入默认值，让用户在表单里看到并确认；发生冲突时优先展示 preset 建议值。
- 用户已经明确比例、分辨率或张数时，按照最终候选路由返回的参数 schema 和组合约束把这些值预填进 `params`；不要猜测 `n`、`size` 等参数名。没有兼容组合时，在提交前说明冲突并让用户选择可用替代值。
- 提示词优化使用一个 `type: "prompt_optimization"` 字段，不提供 `options`。可将选定风格对应的提示词包预填为 `{enabled, routeId, referenceName, referencePrompt}`。
- 用户要求参考已有图片、保持角色一致、多阶段沿用形象或重绘图片时，增加一个 `{type: "images", label: "参考图", max: 3}` 字段。目标资源已有定稿图时，用其资产 ID 填入 `default`，用户可以上传、移除或替换。
- 目标 section 正文中的普通 Markdown 图片不会自动成为参考图；只有 @mention 引用会被自动抽取。需要沿用 section 内图片时，必须把对应资产 ID 明确放入参考图字段默认值或后续 `referenceAssetIds`。
- `ask_user_form` 返回 timeout 时，使用 `await_user_selection` 继续等待同一个 `selectionId`，每轮不超过 90 秒，最多循环 3-5 轮；不要重建表单。返回 cancelled 或持续超时时停止生成。

表单提交后：

- 从 `values.generation` 原样取得 `{routeId, label, params}`；调用生成时不要替换路由，也不要增加、删除或改写其中参数。
- 从 `prompt_optimization` 字段读取优化设置；只有 `enabled: true` 时才构造 `promptOptimization`，并原样传递其中的 `routeId`、`referenceName` 和 `referencePrompt`。
- 从参考图字段取得资产 ID 数组，填入 `referenceAssetIds`。
- 若存在参考图，先用模型目录核对所选路由支持参考图及数量上限。路由不支持或数量超限时，不要静默丢弃参考图，也不要提交生成；说明冲突并重新用一张生成参数表单让用户选择兼容路由或移除多余参考图。

### 4. 构造并提交生成

只有一个目标资源时调用 `generate_media`。多个独立目标资源使用同一套已确认模型与参数时，调用一次
`generate_media_batch`，不要在 Agent 内循环调用 `generate_media`；批次 `items` 中每个目标放一个请求，
`id` 使用能稳定对应目标资源的唯一值，`request` 字段与单次 `generate_media` 参数一致。

每个单次请求或批次子请求至少传入：

- `kind: "image"`
- 表单返回的 `routeId`
- 表单返回的完整 `params`
- 非空 `prompt`
- 可读的 `assetTitle`

按需追加：

- 将选定风格的 `promptSuffix` 拼接到业务 prompt 末尾。preset 参数已经通过表单默认值交给用户确认；提交后不要再次合并或覆盖参数。
- 将参考图资产 ID 填入 `referenceAssetIds`。
- 启用提示词优化时传入 `promptOptimization`。返回 `optimizedPrompt` 后，将它视为实际生成提示词，并在最终结果中向用户展示。
- 为角色、场景、道具或分镜资源生成时必须传该子项自己的 `documentContext`：`documentId` 使用目标文档 ID，`sectionId` 使用目标资源的稳定 section ID；无需自报 `resourceType`，服务端会按文档类型推断。
- 为项目资源生成时，每个子请求都同时传自己的 `notificationTarget`，指向目标文档及章节，以便任务在当前回合结束后仍能发送完成通知。
- `params` 中的生成数量表示“每个目标产出几张”，不能代替批次子项。多个目标必须是多个 batch item；一个目标需要多张候选图才使用路由支持的数量参数。

### 5. 等待任务完成

- `generate_media` 返回的 `id` 就是 `taskId`。`generate_media_batch` 返回批次 `id`，并在每个成功子项中返回独立 `taskId`；单项错误不会取消同批其他任务。
- 批次可用 `list_generation_tasks(batchId: ...)` 汇总查询；对仍为 queued、submitting、submitted 或 running 的子任务，使用各自 `taskId` 调用 `poll_generation_task`，必要时用 `get_generation_task` 读取最新状态和资产。
- 轮询期间保持安静，不要每轮输出状态。状态完成、失败或不可重试时停止轮询。
- 任务失败时展示面向用户的错误信息；仅在任务明确标记可重试且重试仍符合用户原始参数时，才调用 `retry_generation_task`。不要暗中切换模型或参数。
- 如果服务端把长任务留在后台，确认已设置 `notificationTarget`，告知用户任务 ID 和后台状态后结束当前回合，不要无限阻塞。

### 6. 选片并回写

- 任务只返回一张图片时直接使用该资产；返回多张时调用 `ask_user_selection`，每项以图片 URL 作为 `imageUrl`，标签使用“方案一”“方案二”等用户可读名称，不要展示 `slotIndex`。
- 用户选定后，用对应资产的真实 `slotIndex` 调用 `select_generation_asset(taskId, slotIndex)`。生成时未带 `documentContext`、但需要把结果定稿到项目资源时，才补传 `resourceType`（`character`、`scene`、`prop` 或 `storyboard`）。
- 需要写入文档时，将选中资产 URL 以 Markdown 图片或产品支持的资源引用插入目标章节；不要把临时远程供应商 URL 当成本地落库地址。
- 用户取消选片时，不要替用户选择；保留生成历史并说明尚未定稿。

## 最终回复

只总结实际结果：任务状态、定稿资产名、图片地址、落库或目标文档位置，以及启用优化时的 `optimizedPrompt`。不要复述中间选择、轮询和重试过程。
