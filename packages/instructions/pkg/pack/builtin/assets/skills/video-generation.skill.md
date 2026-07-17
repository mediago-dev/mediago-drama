---
name: video-generation
title: 视频生成
description: 用户要求生成视频、动画、动态画面，把图片或分镜转成视频，为角色、场景、道具、镜头出片，做首尾帧衔接或批量出片时使用；负责模型选择、参数确认、首帧参考、提示词优化和异步任务提交，提交成功后由后台完成、落库并通知
---

# 视频生成

## 核心边界

- 使用 MediaGo Drama MCP 完成视频生成，不要临时编写脚本或直接调用供应商接口。
- 只负责目标确认、模型选择、参数确认、参考素材整理和提交；模型路由校验、供应商调用、后台轮询、视频下载与资产落库交给服务端。
- 每次由 Agent 新建视频任务都必须先完成人工确认。用户说“直接生成”“不用问我”或“使用默认值”
  也不能跳过确认卡；这些表达只允许省略重复的自然语言追问。
- 视频生成请求成功提交后，当前 Agent run 的职责立即结束。不要在同一个 run 中等待视频生成完成，
  也不要继续处理任务状态、重试、选片或回写结果；这些后续操作由后台、通知和生成工作台承接。
- 不要编造 `routeId`、`model`、参数名、参数值、文档 ID、section ID、资产 ID 或任务 ID。
- 用户取消选择或表单、明确拒绝生成，或确认卡已过期时，立即停止；不要擅自采用默认值继续生成。

## 标准流程

严格按以下顺序执行；用户已经明确提供的信息不要重复询问。目标是含多个镜头组的分镜文档时，改走下面的“为分镜批量生成视频”一节（其生成设置确认与本流程共用）。

### 1. 锁定目标

- 明确要生成视频的主体、用途和目标资源。常见目标：为某个分镜镜头出片、让角色或场景动起来、把已有定稿图转成视频。角色存在多个时期/形态、同名资源有多个 section，或多个资源都匹配时，调用 `ask_user_selection` 让用户选择具体资源。
- 目标选项使用面向用户的阶段或资源标题；已有定稿图或首帧图时作为选项 `imageUrl`。不要在标签或描述里暴露 section ID、资产 ID 等内部字段。
- 只有唯一匹配，或用户已经明确指定目标文档和 section 时，才跳过目标选择。
- 为项目资源生成时，读取目标二级标题前已有的 `<!-- section-id: ... -->`；保留该值，不要自行计算或伪造。

### 2. 一张表单确认全部生成参数

锁定目标后直接调用一次 `ask_user_form`，标题使用“生成参数”。不要逐个参数追问，也不要用打包方案单选卡代替表单。

- 必须传 `kind: "generation_plan"`，fields 中恰好一个 required `generation_settings`：`{id: "generation", type: "generation_settings", kind: "video", label: "生成设置", required: true}`。不得再添加 `generation_params`、`images`、`prompt_optimization` 或任何 `select`、`toggle`、`number`、`text` 字段，也不得重复该字段。
- 统一生成设置表单会通过实时 HTTP 目录自行加载视频模型、供应商配置、偏好和 route schema，并在用户提交前校验最终设置。Agent 不需要预先查询模型目录；没有可用路由或设置无效时，由表单阻止提交并引导用户处理。
- 同一次 `ask_user_form` 必须传完整 `intent`：`version: 1`；单个目标使用
  `operation: "create_single"` 且恰好一个 item，多个目标使用 `operation: "create_batch"` 且按之后的
  batch item 顺序列出全部 item，顶层 `conversationTitle` 按需使用可读标题。每个 item 必须有稳定唯一
  `id`、`kind: "video"`、将提交的非空基础 `prompt`，
  并按实际请求带上 `assetTitle`、`capabilityId`、`sessionId`、`scopeId`、`documentId`、`sectionId`、
  `documentContext`、`resourceType`、`referenceAssetIds` 和 `notificationTarget`。不要把 `routeId`、`params`、技能包或优化设置放进 intent，这些设置只来自用户提交值。
- 画风、镜头语言、构图等业务要求来自业务 prompt、动态技能包或首帧参考图；不要把它们动态拼成独立表单字段。比例、分辨率、时长及路由声明的其他参数全部由统一设置表单按实时 schema 渲染，与批量生成视频设置共用字段、默认值和校验。
- `generation_settings` 必须带 `kind: "video"`（决定客户端加载视频模型目录），不提供 `options`。没有本轮明确 override 时，不要传 `default`，让表单继承与批量生成弹窗相同的本地保存状态和偏好恢复。
- 只有当前上下文已经有用户明确指定且完整的生成设置时才提供 `default`。一旦提供，必须一次包含 `kind、routeId、label、params、referenceAssetIds、promptSupplements、promptOptimization`。表单会按实时 HTTP 目录规范化或拒绝无效 route 和参数，Agent 不得猜测参数名、参数值或补造目录数据。
- 用户只用自然语言指定比例、分辨率、时长或是否生成音频，而当前上下文没有对应 route 的完整设置对象时，不要猜测 `duration`、`resolution`、`size` 等参数名；让用户在统一表单中按实时 schema 确认这些显式参数。
- 用户要求以某张图作为视频首帧、保持角色或场景一致、从上一镜尾帧衔接，或把已有定稿图转成视频时，把目标资产作为参考候选，并让用户在统一表单内确认、上传、移除或替换；已有完整 `default` 时把资产 ID 放入其中的 `referenceAssetIds`。视频参考图语义是“首帧或画面参考”，与图片的风格参考不同。
- 目标 section 正文中的普通 Markdown 图片不会自动成为参考图；只有 @mention 引用会被自动抽取。需要沿用 section 内图片作为首帧时，必须在统一表单中明确选中对应资产。
- 不要在表单前单独展示通用“风格选择”卡。视频的画风、镜头语言和氛围来自 `prompt`、用户可维护的动态技能包或首帧参考图；模型 route schema 中名为 `style` 的参数仍由表单正常渲染。
- `promptSupplements` 保存统一表单中选择的动态技能包快照；`promptOptimization` 保存开关、文本 route 和优化技能包快照。两者都属于同一个 `generation_settings` value，不是独立字段。
- `timeout` 只是一次 MCP 阻塞等待结束的**传输心跳**，不代表用户已决定、取消或授权继续。收到 timeout 后，必须对同一个 `selectionId` 持续调用 `await_user_selection`（每轮不超过 90 秒），不要重建表单、不要设置轮数上限。处于 timeout/pending 时不得调用其他工具、不得生成、不得结束回合或发送最终答复；只有返回 `submitted` 后才能继续。返回 `cancelled` 或 `expired` 时停止生成。

表单提交后：

- 保存 `ask_user_form` 返回的 `selectionId`；它只能在创建它的当前 session/run 中单次使用，只授权随后
  这一份完整单项请求或完整批次请求。不要用于第二次提交、不同 intent、重试或新 run。
- 当前 run 上下文缺失，或服务端报告 selection 已使用、过期、不匹配、无法核验时，必须失败关闭并停止；
  不得省略 `confirmationSelectionId`、改用旧 selection 或降级成无确认生成。
- 从 `values.generation` 原样取得完整设置快照。调用生成时不要替换路由，也不要增加、删除或改写其中参数、参考资产或提示词设置。
- 将其中 `referenceAssetIds` 与 `promptSupplements` 原样传入生成请求；只有 `promptOptimization.enabled: true` 时才构造 `promptOptimization`，并原样传递其中的 `routeId`、`referenceName` 和 `referencePrompt`。
- 若存在首帧/参考图，以统一表单基于实时目录给出的兼容性与数量校验为准。路由不支持或数量超限时，不要静默丢弃参考图，也不要提交生成；让用户在表单中选择兼容路由或移除多余参考图。

### 3. 构造并提交生成

只有一个目标资源时调用 `generate_media`。多个独立镜头或资源使用同一套已确认模型与参数时，调用一次
`generate_media_batch`，不要在 Agent 内循环调用 `generate_media`；批次 `items` 中每个目标放一个请求，
`id` 使用能稳定对应目标资源的唯一值并与 create_batch intent 的 item 顺序、ID 和 prompt 对齐，
`request` 字段与单次 `generate_media` 参数一致。
标准流程中的多个独立目标超过 50 个时，在提交前让用户确认本轮不超过 50 个目标的范围；一个批次提交成功后必须结束当前 run，剩余目标留到后续 run 重新确认生成参数后提交。不要提交超限批次，也不要在同一个 run 继续调用第二个批次。

确认 ID 的位置固定：

- 调用 `generate_media` 时，把表单返回的 `selectionId` 作为该单项请求的 `confirmationSelectionId`。
- 调用 `generate_media_batch` 时，只在批次顶层传一次 `confirmationSelectionId`；
  `items[].request` 不得重复传确认 ID。一个批次级确认授权整个有序批次，不是每个子项各自授权。

每个单次请求或批次子请求至少传入：

- `kind: "video"`
- 表单返回的 `routeId`
- 表单返回的完整 `params`
- 非空 `prompt`
- 可读的 `assetTitle`

按需追加：

- 将首帧/参考图资产 ID 填入 `referenceAssetIds`。
- 启用提示词优化时传入 `promptOptimization`。提交响应返回 `optimizedPrompt` 时，将它视为实际生成提示词，并在本轮提交结果回复中展示。
- 为角色、场景、道具或分镜资源生成时必须传该子项自己的 `documentContext`：`documentId` 使用目标文档 ID，`sectionId` 使用目标资源的稳定 section ID；无需自报 `resourceType`，服务端会按文档类型推断。
- 为项目资源生成时，每个子请求都同时传自己的 `notificationTarget`，指向目标文档及章节，以便任务在当前回合结束后仍能发送完成通知。
- 多个镜头必须是多个 batch item；不要用参数里的时长或数量代替多个镜头子项。

### 4. 提交即结束

- `generate_media` 返回的 `id` 就是 `taskId`。`generate_media_batch` 返回批次 `id`，并在每个成功子项中返回独立 `taskId`；单项错误不会取消同批其他任务。
- 状态为 queued、submitting、submitted 或 running 都表示请求已被接受。视频生成请求成功提交后，当前 Agent run 的职责立即结束。
- 不要在同一个 run 中等待视频生成完成，也不要继续执行任何任务状态或资产处理动作。
- 不得展示结果选片卡，不得把生成结果回写到文档，也不得等待 `returnLastFrame` 尾帧去衔接下一镜。
  后台服务会继续执行任务、同步状态、落库结果并发送完成通知；这是已接受任务的后台履约，
  不需要也不得再次弹出生成确认。
- 后续任务状态、重试和选片由生成工作台承接；Agent 不为这些工作暴露另一套生成流程。
- 携带 `documentContext` 的项目资源会在后台完成后自动选中本次第一条视频；人工改选、自由生成视频的后续落位、显式文档插入和尾帧衔接留给用户之后发起的独立操作。
- 单次提交只报告 `taskId` 和初始后台状态；批次提交报告批次 `id`、成功接收的子项 `taskId` 和即时提交失败的子项。不要为了汇总最终结果继续查询任务。
- 如果提交调用没有接受任何任务，只报告这次即时提交错误并停止；不要暗中切换模型、参数或在同一个 run 内自动重试。

## 为分镜批量生成视频

目标是含多个镜头组的分镜文档（正文用 `## 第 0N 组` 二级标题分组）时按本节执行。本节替代标准流程的第 1、3、4 步；第 2 步统一生成设置表单仍然共用。

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

- 从目标集合里挑一个代表镜头（优先用户点名的组，否则取集合中第一组），按标准流程第 3 步用 `generate_media` 单独提交一条。试片提交成功后立即结束当前 run，不要等待试片完成或继续批量。
- 试片完成后由后台通知用户。用户在后续 run 明确确认满意时，再重新打开统一表单、重新确认生成参数并提交其余镜头组；`confirmationSelectionId` 绑定原 run，不得跨 run 复用。用户要求调整时同样在后续 run 重新确认，不要擅自换模型。
- 用户在范围表单里关闭“先试片”或明确要求直接全部时，跳过试片，直接进入批量提交。

### B4. 批量提交（generate_media_batch，一组一个 item）

- 对目标集合调用一次 `generate_media_batch`，**不要在 Agent 内循环调用 `generate_media`**。在批次顶层只传一次
  本轮表单返回的 `confirmationSelectionId`，子项 request 不传确认 ID。已试片并采用的那个代表镜头不要重复生成。
  单个批次最多 50 个子项；目标镜头超过 50 个时，在提交前让用户确认本轮不超过 50 组的范围。
  一个批次提交成功后必须结束当前 run，剩余范围留到后续 run 重新确认参数后提交；不要在同一个 run
  继续调用第二个批次，也不要把超限集合塞进一次调用。
- `items` 中每个镜头组一个请求：
  - `id` 使用能稳定对应该镜头组的唯一值（例如其 section ID 或组号），便于后台任务与目标资源对号入座。
  - `request` 与单次 `generate_media` 的媒体参数一致：`kind: "video"`、表单返回的 `routeId` 与完整
    `params`、非空 `prompt`、可读 `assetTitle`，但不含 `confirmationSelectionId`。
  - `prompt` 取该镜头组的画面与动作描述，并沿用整批统一的风格与一致性要求（人物、场景、镜头语言）。
  - `documentContext` 用该镜头组自己的 `{documentId, sectionId}`；`notificationTarget` 指向该镜头组，确保回合结束后仍能逐条通知。
  - 需要首帧衔接时，把该镜头的定稿关键帧或上一镜尾帧资产 ID 填入该子项的 `referenceAssetIds`。

### B5. 批次提交即结束

- 确认每个项目资源子项都带了 `notificationTarget` 后提交批次。返回批次 `id` 和各镜头 `taskId` 后立即结束当前 run，不要查询、轮询或等待任何子任务完成。
- 后台会按各子项的 `documentContext` 落库并自动选中第一条视频，完成后逐条通知；它不会修改分镜 Markdown。需要显式插入文档、人工改选或使用 `returnLastFrame` 衔接下一镜时，由用户在后续 run 单独发起。
- 即时返回的部分子项错误不影响已接受任务；只在本轮回复中列出已接受子项和即时错误，不汇总最终成功/失败镜头数，也不在同一个 run 自动重试。

## 最终回复

只总结提交结果：任务或批次 ID、已接受的子任务 ID、初始后台状态、即时提交错误，以及返回时已有的 `optimizedPrompt`。明确说明任务会在后台继续并在完成后通知；不要声称视频已经完成，不要给出尚不存在的视频地址、尾帧、定稿资产名或文档位置。
