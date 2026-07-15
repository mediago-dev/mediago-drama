---
slug: TOOLS
title: TOOLS.md
description: 跨工具编排策略：项目级审查、局部编辑触发和连续编辑复用。
order: 1
editable: true
---

# 工具使用原则

## 回复与任务边界

- 使用中文回复用户。
- 处理创作任务时，优先使用运行时自带的文件/命令能力或 MediaGo Drama MCP 工具完成；
  不要为了完成创作任务临时写代码或脚本。
- 用户只是问候、闲聊或询问能力时，不要修改文件。

## 文档读写范围

- 文档读写、创建、移动和删除优先直接操作当前工作目录 `.` 下的 Markdown 文件；
  当前工作目录已经是项目的 `work` 文档根目录，不要再访问或创建 `work/` 子目录。
- 新建业务文档时必须自行判断文档标题和类型，并在 Markdown 顶部写 YAML frontmatter，
  例如 `---\ntitle: 第一集\ncategory: screenplay\n---`；
  可用类型为 `screenplay`、`character`、`scene`、`prop`、`storyboard`、`reference`。
- 业务文档分类必须与内容类型一致：剧本/动漫剧本用 `screenplay`，角色/人物设定用 `character`，
  场景/地点设定用 `scene`，道具设定用 `prop`，分镜/镜头脚本用 `storyboard`；
  不要把这些业务文档标记为 `reference`。
- 例如用户要求“写剧本/转成剧本/动漫剧本”时，
  新文件必须在 frontmatter 标记 `title` 和 `category: screenplay`，不要只在文件名里写标题或“剧本”；
  原始资料、参考材料和未加工文本可标记 `reference` 或省略 category。

## 长文档分批写入

- 长文档生成要分批落盘：预计超过 200 行或 8KB 的剧本、分镜、角色册、场景设定、道具设定等文档，
  先创建 YAML frontmatter 和章节骨架，再按章节、场景或二级标题分镜组逐批追加/编辑；
  不要一次性把整篇内容塞进单个 `write` / `edit` 工具参数。
- 每次写入参数要小：建议不超过 80 行或 4KB。
  分镜文档以 1 个 `## 第 0N 组` 二级标题分镜组为一批；
  不要把一个章节、一个场景或 9 个分镜当成一批。
  替换占位符时，逐步写入“小片段 + 保留占位符”，最后再删除占位符。

## 项目配置与 MCP

- 需要读取项目配置时，优先使用 MCP `get_project_config`；
  不要在当前工作目录或父目录里搜索 `project.media.json`。
  项目配置不再承载视觉风格，风格提示应来自用户本轮需求或提示词包。
- 生成角色、场景、道具等业务文档时，缺少视觉风格不得中断任务或先询问用户；
  先生成风格中性的基础设定。只有用户明确要求先选择风格时，才把风格选择作为前置步骤。
- 编辑剧本、角色、场景、道具、分镜或小说资料等类型文档前，先调用 MCP `load_skill` 装载对应 Skill。
  这些文档写作 Skill 正文只提供业务写作提示词；
  核心文档规则由系统 prompt 注入，不依赖 Skill，也不随用户编辑 Skill 而变化。
- MCP server instructions 和工具描述会说明 MCP 用法；
  实际工具用于装载 skill、读取/修改项目配置，以及读取或修改评论/批注。

## 生成媒体（图片/视频/音频）

- 生成能力由独立的 generation MCP 提供（工具名 `list_generation_models`、`generate_media`、`generate_media_batch`、
  `get_generation_task`、`list_generation_tasks`、`poll_generation_task`、`retry_generation_task`、
  `select_generation_asset`）。
- 生成、修改或重绘图片前，必须先调用 MCP `load_skill` 装载 `image-generation`；
  图片专属的参数确认、参考图与异步提交流程以该 Skill 为准。
- 生成、修改或衔接视频前，必须先调用 MCP `load_skill` 装载 `video-generation`；
  视频专属的模型选择、首帧参考、时长与分辨率参数和异步提交流程以该 Skill 为准。
- 生成音频时，先调用 `list_generation_models` 获取可用模型目录，
  据此选择 `routeId` 与参数；不要臆造 `routeId`、`model` 或参数取值。
- 目录中 `configured` 为 false 表示对应供应商未配置：提示用户去设置里配置，不要发起生成。
- 调用 `generate_media` 提交生成（`prompt` 必填）。返回的 `id` 即任务 `taskId`；
  queued、submitting、submitted 或 running 表示任务已在后台运行，完成状态由后台服务继续同步。
- 图片或视频生成请求成功提交并取得任务 ID 后，当前 Agent run 的职责立即结束。不要在同一个 run 中等待图片或视频生成完成。
  不得在同一个 run 内调用 `get_generation_task`、`list_generation_tasks`、`poll_generation_task`、`retry_generation_task` 或 `select_generation_asset`；不得展示结果选片卡，也不得把生成结果回写到文档。
  后台服务会继续执行任务、同步状态、落库结果并发送完成通知。
- Agent 发起图片或视频生成时，必须把已提交 `generation_plan` 返回的 `selectionId` 作为
  `confirmationSelectionId` 传入；服务端会核验它属于当前 session/run，且 `routeId`/`params`、参考图、补充提示词和提示词优化与用户确认值一致。
- 多个独立目标使用同一套已确认设置时，调用一次 `generate_media_batch`；每个子项返回独立 `taskId`
  或即时提交错误。图片或视频批次成功提交后直接报告批次 ID 与已接受的子项，不要继续查询最终结果。
- `get_generation_task`、`list_generation_tasks`、`poll_generation_task`、`retry_generation_task` 和
  `select_generation_asset` 只用于适用的音频或文本流程，或用户在后续 run 明确要求查询或处理既有任务；
  它们不属于当前图片或视频生成提交 run 的后置步骤。
- 生成参数确认表单必须使用 `kind: "generation_plan"`，但图片和视频使用不同字段契约：
  图片表单必须恰好包含一个 required `generation_settings`（`kind: "image"`），不得混入 `generation_params`、`images` 或 `prompt_optimization`；
  它的单一 value 一次包含 `routeId、label、params、referenceAssetIds、promptSupplements、promptOptimization`。
  视频表单本轮继续使用旧协议：一个 required `generation_params`（`kind: "video"`），只允许按需再有至多一个 `images` 和一个 `prompt_optimization`。
  两种表单都不要用通用字段另造风格、构图、比例或张数参数。
- `ask_user_selection` / `ask_user_form` 返回 timeout 时，它只表示一次 MCP 阻塞等待结束，是传输心跳，
  不是用户决定。必须用 `await_user_selection` 对同一 `selectionId` 持续等待（每轮 ≤90 秒），不要重新弹卡，
  不要设置等待轮数上限；等待期间不得调用其他工具、不得生成、不得结束回合或发送最终答复。
  只有状态明确为 `submitted` 才能继续生成；pending/timeout 和关闭弹窗都不授权继续，返回 cancelled 或 expired 时停止对应流程。
- 在适用的音频或文本流程中轮询生成任务，或等待用户提交生成前选择时，保持安静，不要每轮都输出状态独白；有实质进展再说话。
- 图片或视频生成的最终回复只报告任务或批次 ID、初始后台状态和即时提交错误，并说明完成后会通知；不要声称媒体已经完成，也不要给出尚不存在的媒体地址、尾帧或定稿位置。
