---
name: image-generation
title: 图片生成
description: 用户要求生成、配图、画图、重绘、修改、批量制作图片，或为角色、场景、道具、分镜生成视觉资产时使用；负责模型与生成设置确认、参考图、提示词增强和异步任务提交，提交成功后由后台完成、落库并通知
---
# 图片生成

## 核心边界

- 使用 MediaGo Drama MCP 完成图片生成，不要临时编写脚本或直接调用供应商接口。
- 只负责目标确认、模型选择、参数确认和提交；模型路由校验、供应商调用、后台执行、状态同步、图片下载与资产落库交给服务端。
- 每次由 Agent 新建图片任务都必须先完成人工确认。用户说“直接生成”“不用问我”或“使用默认值”
  也不能跳过确认卡；这些表达只允许省略重复的自然语言追问。
- 图片生成请求成功提交后，当前 Agent run 的职责立即结束。不要在同一个 run 中等待图片生成完成，
  也不要继续处理任务状态、重试、选片或回写结果；这些后续操作由后台、通知和生成工作台承接。
- 不要编造 `routeId`、`model`、参数名、参数值、文档 ID、section ID、资产 ID 或任务 ID。
- 用户取消选择或表单、明确拒绝生成，或确认卡已过期时，立即停止；不要擅自采用默认值继续生成。

## 标准流程

严格按以下顺序执行；用户已经明确提供的信息不要重复询问。

### 1. 锁定目标

- 明确要生成的主体、用途和目标资源。角色存在多个时期/形态、同名资源有多个 section，或多个资源都匹配时，调用 `ask_user_selection` 让用户选择具体资源。
- 目标选项使用面向用户的阶段或资源标题；已有定稿图时作为选项 `imageUrl`。不要在标签或描述里暴露 section ID、资产 ID 等内部字段。
- 只有唯一匹配，或用户已经明确指定目标文档和 section 时，才跳过目标选择。
- 为项目资源生成时，读取目标二级标题前已有的 `<!-- section-id: ... -->`；保留该值，不要自行计算或伪造。

### 2. 一张表单确认全部生成参数

锁定目标后直接调用一次 `ask_user_form` 打开统一生成设置表单，标题使用“生成参数”。不要逐个参数追问，也不要用打包方案单选卡代替表单。

- 必须传 `kind: "generation_plan"`，fields 中恰好一个 required `generation_settings`：`{id: "generation", type: "generation_settings", kind: "image", label: "生成设置", required: true}`。不得再添加 `generation_params`、`images`、`prompt_optimization` 或任何 `select`、`toggle`、`number`、`text` 字段，也不得重复该字段。
- 统一生成设置表单会通过实时 HTTP 目录自行加载图片模型、供应商配置、偏好和 route schema，并在用户提交前校验最终设置。Agent 不需要预先查询模型目录；没有可用路由或设置无效时，由表单阻止提交并引导用户处理。
- 同一次 `ask_user_form` 必须传完整 `intent`：`version: 1`；单个目标使用
  `operation: "create_single"` 且恰好一个 item，多个目标使用 `operation: "create_batch"` 且按之后的
  batch item 顺序列出全部 item，顶层 `conversationTitle` 按需使用可读标题。每个 item 必须有稳定唯一
  `id`、`kind: "image"`、将提交的非空基础 `prompt`，
  并按实际请求带上 `assetTitle`、`capabilityId`、`sessionId`、`scopeId`、`documentId`、`sectionId`、
  `documentContext`、`resourceType`、`referenceAssetIds` 和 `notificationTarget`。不要把 `routeId`、`params`、技能包或优化设置放进 intent，这些设置只来自用户提交值。
- 这个单一字段就是图片批量生成弹窗的完整同源表单，统一渲染模型、route schema 参数、参考图、附加提示词和优化提示词。视觉风格、构图、景别等业务要求来自业务 prompt 或用户在表单中选择的动态技能包；不要在表单前另造固定风格字段。
- `default` 可省略；没有本轮明确 override 时，不要传 `default`。共享表单会按与批量生成弹窗相同的本地保存状态和偏好恢复，并用实时目录校验恢复结果。
- 只有当前上下文已经有用户明确指定且完整的生成设置时才提供 `default`。一旦提供，必须是完整设置对象，并一次包含 `kind、routeId、label、params、referenceAssetIds、promptSupplements、promptOptimization`；不提供 `options`。表单会按实时 HTTP 目录规范化或拒绝无效 route 和参数，Agent 不得猜测参数名、参数值或补造目录数据。
- 用户已经明确比例、分辨率或张数，但当前上下文没有对应 route 的完整设置对象时，不要猜测 `n`、`size` 等参数名；让用户在统一表单中按实时 schema 确认这些显式参数。
- 用户要求参考已有图片、保持角色一致、多阶段沿用形象或重绘图片时，把目标资源已有定稿图作为参考候选，并让用户在统一表单里确认、上传、移除或替换；已有完整 `default` 时把资产 ID 放入其中的 `referenceAssetIds`。目标 section 正文中的普通 Markdown 图片不会自动成为参考图；只有 @mention 引用会被自动抽取。
- 不要在表单前单独展示通用“风格选择”卡。用户明确提出的画风保留在业务 prompt 中，用户可维护的动态技能包由统一表单选择；分类名即使是“风格”，也只作为普通动态技能包。模型 route schema 中名为 `style` 的参数仍由表单正常渲染。
- `promptSupplements` 保存用户在统一表单中选择的动态技能包快照；`promptOptimization` 保存开关、文本 route 和优化技能包快照。两者都属于同一个 `generation_settings` value，不是独立字段。
- `timeout` 只是一次 MCP 阻塞等待结束的**传输心跳**，不代表用户已决定、取消或授权继续。收到 pending/timeout 后，必须对同一个 `selectionId` 持续调用 `await_user_selection`（每轮不超过 90 秒），不要重建表单、不要设置轮数上限；此时不得调用其他工具、不得生成、不得结束回合或发送最终答复。用户关闭弹窗或返回 `cancelled` / `expired` 时立即停止。只有状态明确为 `submitted`，且返回了该单一字段的完整 value 后，才能继续生成。

表单提交后：

- 保存 `ask_user_form` 返回的 `selectionId`；它只能在创建它的当前 session/run 中单次使用，只授权随后
  这一份完整单项请求或完整批次请求。不要用于第二次提交、不同 intent、重试或新 run。
- 当前 run 上下文缺失，或服务端报告 selection 已使用、过期、不匹配、无法核验时，必须失败关闭并停止；
  不得省略 `confirmationSelectionId`、改用旧 selection 或降级成无确认生成。
- 从 `values.generation` 一次取得完整 `{kind, routeId, label, params, referenceAssetIds, promptSupplements, promptOptimization}`。不要再读取其他表单字段，也不要替换路由、增删参数、丢弃参考图或改写提示词设置。
- 生成请求原样使用其中的 `routeId`、`params`、`referenceAssetIds` 和 `promptSupplements`；仅当 `promptOptimization.enabled: true` 时传入完整 `promptOptimization`，关闭时省略请求字段。
- 若提交值与目录或用户预期冲突，不要在表单关闭后私自修正并继续；停止提交并重新发起一张新的统一设置表单让用户确认。

### 3. 构造并提交生成

只有一个目标资源时调用 `generate_media`。多个独立目标资源使用同一套已确认模型与参数时，调用一次
`generate_media_batch`，不要在 Agent 内循环调用 `generate_media`；批次 `items` 中每个目标放一个请求，
`id` 使用能稳定对应目标资源的唯一值并与 create_batch intent 的 item 顺序、ID 和 prompt 对齐，
`request` 字段与单次 `generate_media` 参数一致。

确认 ID 的位置固定：

- 调用 `generate_media` 时，把表单返回的 `selectionId` 作为该单项请求的 `confirmationSelectionId`。
- 调用 `generate_media_batch` 时，只在批次顶层传一次 `confirmationSelectionId`；
  `items[].request` 不得重复传确认 ID。一个批次级确认授权整个有序批次，不是每个子项各自授权。

每个单次请求或批次子请求至少传入：

- `kind: "image"`
- 表单返回的 `routeId`
- 表单返回的完整 `params`
- 表单返回的完整 `promptSupplements`
- 非空 `prompt`
- 可读的 `assetTitle`

按需追加：

- 将统一表单返回的 `promptSupplements` 和 `referenceAssetIds` 原样传递；不要在 Agent 里根据固定风格配置手工拼接 prompt，也不要在提交后再次合并、删减或覆盖。
- 启用提示词优化时原样传入 `promptOptimization`。提交响应返回 `optimizedPrompt` 时，将它视为实际生成提示词，并在本轮提交结果回复中展示。
- 为角色、场景、道具或分镜资源生成时必须传该子项自己的 `documentContext`：`documentId` 使用目标文档 ID，`sectionId` 使用目标资源的稳定 section ID；无需自报 `resourceType`，服务端会按文档类型推断。
- 为项目资源生成时，每个子请求都同时传自己的 `notificationTarget`，指向目标文档及章节，以便任务在当前回合结束后仍能发送完成通知。
- `params` 中的生成数量表示“每个目标产出几张”，不能代替批次子项。多个目标必须是多个 batch item；一个目标需要多张候选图才使用路由支持的数量参数。

### 4. 提交即结束

- `generate_media` 返回的 `id` 就是 `taskId`。`generate_media_batch` 返回批次 `id`，并在每个成功子项中返回独立 `taskId`；单项错误不会取消同批其他任务。
- 状态为 queued、submitting、submitted 或 running 都表示请求已被接受。图片生成请求成功提交后，当前 Agent run 的职责立即结束。
- 不要在同一个 run 中等待图片生成完成，也不要继续执行任何任务状态或资产处理动作。
- 不得展示结果选片卡，不得把生成结果回写到文档。后台服务会继续执行任务、同步状态、落库结果并发送完成通知；
  这是已接受任务的后台履约，不需要也不得再次弹出生成确认。
- 后续任务状态、重试和选片由生成工作台承接；Agent 不为这些工作暴露另一套生成流程。
- 携带 `documentContext` 的项目资源会在后台完成后自动选中本次第一张结果；多图改选、自由生成图片的后续落位或显式文档插图留给用户之后发起的独立操作。
- 单次提交只报告 `taskId` 和初始后台状态；批次提交报告批次 `id`、成功接收的子项 `taskId` 和即时提交失败的子项。不要为了汇总最终结果继续查询任务。
- 如果提交调用没有接受任何任务，只报告这次即时提交错误并停止；不要暗中切换模型、参数或在同一个 run 内自动重试。

## 最终回复

只总结提交结果：任务或批次 ID、初始后台状态、即时提交错误，以及返回时已有的 `optimizedPrompt`。明确说明任务会在后台继续并在完成后通知；不要声称图片已经完成，不要给出尚不存在的图片地址或定稿位置。
