---
name: image-generation
title: 图片生成与选片
description: 用户要求生成、配图、画图、重绘、修改、批量制作图片，或为角色、场景、道具、分镜生成视觉资产时使用；负责模型与生成设置确认、参考图、提示词增强、任务轮询、选片和文档回写
---
# 图片生成与选片

## 核心边界

- 使用 MediaGo Drama MCP 完成图片生成，不要临时编写脚本或直接调用供应商接口。
- 只负责目标确认、模型选择、参数确认、提交、轮询、选片和回写；模型路由校验、供应商调用、图片下载与资产落库交给服务端。
- 不要编造 `routeId`、`model`、参数名、参数值、文档 ID、section ID、资产 ID 或任务 ID。
- 用户取消选择或表单、明确拒绝生成，或确认卡已过期时，立即停止；不要擅自采用默认值继续生成。

## 标准流程

严格按以下顺序执行；用户已经明确提供的信息不要重复询问。

### 1. 锁定目标

- 明确要生成的主体、用途和目标资源。角色存在多个时期/形态、同名资源有多个 section，或多个资源都匹配时，调用 `ask_user_selection` 让用户选择具体资源。
- 目标选项使用面向用户的阶段或资源标题；已有定稿图时作为选项 `imageUrl`。不要在标签或描述里暴露 section ID、资产 ID 等内部字段。
- 只有唯一匹配，或用户已经明确指定目标文档和 section 时，才跳过目标选择。
- 为项目资源生成时，读取目标二级标题前已有的 `<!-- section-id: ... -->`；保留该值，不要自行计算或伪造。

### 2. 获取模型目录

- 调用 `list_generation_models`，固定传入 `kind: "image"`。
- 只使用返回目录中 `configured: true` 的图片路由。没有已配置路由时，提示用户前往设置配置供应商并停止。
- 不要在模型目录之后单独展示通用“风格选择”卡。视觉风格不是固定全局参数：用户明确提出的画风保留在业务 prompt 中，用户可维护的动态提示词包则在下一步统一生成设置表单中选择。
- 提示词包分类由用户自行新增、修改或删除；即使分类名是“风格”，也只把它当作普通动态提示词包，不能把分类或选项硬编码进 Agent 工作流。
- 模型路由 schema 如果声明名为 `style` 的参数，仍由统一表单按 route schema 正常渲染；不要因为移除了通用风格步骤而过滤模型参数。

### 3. 一张表单确认全部生成参数

获取目录后直接调用一次 `ask_user_form` 打开统一生成设置表单，标题使用“生成参数”。不要逐个参数追问，也不要用打包方案单选卡代替表单。

- 必须传 `kind: "generation_plan"`，fields 中恰好一个 required `generation_settings`：`{id: "generation", type: "generation_settings", kind: "image", label: "生成设置", required: true}`。不得再添加 `generation_params`、`images`、`prompt_optimization` 或任何 `select`、`toggle`、`number`、`text` 字段，也不得重复该字段。
- 这个单一字段就是图片批量生成弹窗的完整同源表单，统一渲染模型、route schema 参数、参考图、附加提示词和优化提示词。视觉风格、构图、景别等业务要求来自业务 prompt 或用户在表单中选择的动态提示词包；不要在表单前另造固定风格字段。
- `default` 可省略；没有本轮明确 override 时，不要传 `default`。这里的 override 指用户本轮明确指定的模型、route 参数或参考资产等设置；不传时，共享表单会按与批量生成弹窗相同的本地保存状态和偏好恢复。不要仅因为调用了 `list_generation_models` 就合成一个 Agent 默认值覆盖它们。
- 只有用户本轮明确指定任务参数、引用等设置时才提供 `default`。一旦提供，必须是完整设置对象，一次包含 `kind、routeId、label、params、referenceAssetIds、promptSupplements、promptOptimization`。基础形状为 `{kind: "image", routeId, label, params, referenceAssetIds: [], promptSupplements: [], promptOptimization: {enabled: false}}`；不提供 `options`。
- 需要提供 `default` 时，用 `list_generation_models` 返回的图片偏好和 configured route 构造 `routeId`、可读 `label` 与 schema 默认 `params`，再应用用户明确的本次任务设置；不要编造目录中不存在的 route 或参数。
- 用户已经明确比例、分辨率或张数并需要提供 `default` 时，按照最终候选路由返回的参数 schema 和组合约束把这些值预填进 `params`；不要猜测 `n`、`size` 等参数名。没有兼容组合时，在提交前说明冲突并让用户选择可用替代值。
- 用户要求参考已有图片、保持角色一致、多阶段沿用形象或重绘图片时，需要提供完整 `default`，并把目标资源已有定稿图的资产 ID 预填进同一对象的 `referenceAssetIds`；用户可在统一表单里上传、移除或替换。目标 section 正文中的普通 Markdown 图片不会自动成为参考图；只有 @mention 引用会被自动抽取。
- `promptSupplements` 保存用户在统一表单中选择的动态提示词包快照；`promptOptimization` 保存开关、文本 route 和优化提示词包快照。两者都属于同一个 `generation_settings` value，不是独立字段。
- `timeout` 只是一次 MCP 阻塞等待结束的**传输心跳**，不代表用户已决定、取消或授权继续。收到 pending/timeout 后，必须对同一个 `selectionId` 持续调用 `await_user_selection`（每轮不超过 90 秒），不要重建表单、不要设置轮数上限；此时不得调用其他工具、不得生成、不得结束回合或发送最终答复。用户关闭弹窗或返回 `cancelled` / `expired` 时立即停止。只有状态明确为 `submitted`，且返回了该单一字段的完整 value 后，才能继续生成。

表单提交后：

- 保存 `ask_user_form` 返回的 `selectionId`；后续每个图片生成请求都必须原样作为 `confirmationSelectionId` 传入。不要使用其他 selection，也不要在新 run 中复用。
- 从 `values.generation` 一次取得完整 `{kind, routeId, label, params, referenceAssetIds, promptSupplements, promptOptimization}`。不要再读取其他表单字段，也不要替换路由、增删参数、丢弃参考图或改写提示词设置。
- 生成请求原样使用其中的 `routeId`、`params`、`referenceAssetIds` 和 `promptSupplements`；仅当 `promptOptimization.enabled: true` 时传入完整 `promptOptimization`，关闭时省略请求字段。
- 若提交值与目录或用户预期冲突，不要在表单关闭后私自修正并继续；停止提交并重新发起一张新的统一设置表单让用户确认。

### 4. 构造并提交生成

只有一个目标资源时调用 `generate_media`。多个独立目标资源使用同一套已确认模型与参数时，调用一次
`generate_media_batch`，不要在 Agent 内循环调用 `generate_media`；批次 `items` 中每个目标放一个请求，
`id` 使用能稳定对应目标资源的唯一值，`request` 字段与单次 `generate_media` 参数一致。

每个单次请求或批次子请求至少传入：

- 表单返回的 `selectionId`，字段名为 `confirmationSelectionId`
- `kind: "image"`
- 表单返回的 `routeId`
- 表单返回的完整 `params`
- 表单返回的完整 `promptSupplements`
- 非空 `prompt`
- 可读的 `assetTitle`

按需追加：

- 将统一表单返回的 `promptSupplements` 和 `referenceAssetIds` 原样传递；不要在 Agent 里根据固定风格配置手工拼接 prompt，也不要在提交后再次合并、删减或覆盖。
- 启用提示词优化时原样传入 `promptOptimization`。返回 `optimizedPrompt` 后，将它视为实际生成提示词，并在最终结果中向用户展示。
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
