# Agent Generation MCP 工具收缩设计

## 背景

当前 Generation MCP 暴露 8 个工具。图片与视频业务已经演进为“统一生成设置表单确认 → Agent 提交 → 后台履约 → 工作台和通知承接后续操作”。Agent 不再等待完成，也不负责查询、重试、轮询或选片；统一表单已经通过 HTTP `/generation/models` 自行加载模型目录、供应商配置、偏好和参数 schema。

继续暴露旧工具会扩大 Agent 的选择空间，迫使提示词解释“哪些可见工具不能调用”，还会保留一套与工作台职责重复的 Agent 重试协议。

## 决策

Generation MCP 只保留：

- `generate_media`
- `generate_media_batch`

完整移除以下 MCP 工具及其专属契约和适配代码：

- `list_generation_models`
- `get_generation_task`
- `list_generation_tasks`
- `retry_generation_task`
- `poll_generation_task`
- `select_generation_asset`

“完整移除”只针对 Agent MCP 边界。底层 GenerationService、HTTP API、后台任务轮询、生成工作台查询/选片全部保留，HTTP 重试接口与前端 API wrapper 也继续存在。工作台仍通过 HTTP 获取目录，后台 worker 仍轮询异步任务并发送完成通知。

## 保留的授权边界

`generation_plan` 继续绑定图片/视频创建意图与用户提交的 `generation_settings`，并保留：

- project/session/run fail-closed 校验；
- 单项与有序批次的完整请求匹配；
- selection single-use claim；
- 请求指纹、并发冲突保护和结果重放；
- 已接受任务的后台履约无需再次确认。

这些逻辑继续保护两个保留工具。显式 caller mode 也继续保留，因为它描述的是保留工具的信任边界。

## 删除的重试协议

Agent MCP 不再负责重试，因此删除：

- `generation_retry_plan` selection kind；
- `confirm_retry` 固定选项；
- generation intent 中的 `retryTaskId` 和 retry operation；
- `generation_retry_confirmation.go`；
- 重试专属 MCP DTO、授权、claim、结果封装和测试；
- Agent 指令、图片/视频 Skill 和前端意图摘要中的重试协议文案。

已有 HTTP 重试接口和前端 API wrapper 继续保留；当前工作台尚未接线重试按钮，因此本次不把“按钮可用”列为验收结论。底层任务 retry 状态、attempt、延迟恢复和服务方法不删除。

## 模型目录与音频边界

图片和视频的 `generation_settings` 表单复用 `useGenerationSettingsForm` / `useGenerationWorkspace`，由前端自行获取实时目录并验证 configured route，因此 Agent 不需要 `list_generation_models`。

音频和文本底层生成能力暂时保留在 `generate_media` 服务契约中，但不再宣称拥有完整的 Agent 目录选择、轮询和重试工作流。未来若支持 Agent 配音，应单独设计统一音频表单或配音流程。

## 测试策略

1. MCP tools/list 精确断言只包含两个生成工具。
2. MCP schema 继续覆盖单项和批次确认字段。
3. 创建确认继续覆盖 fail-closed、意图匹配、single-use、并发和结果重放。
4. selection 测试删除 retry plan 分支，只接受 create single/batch。
5. 指令和 Skill 不再出现被移除工具或 Agent 重试协议。
6. 前端意图摘要保留创建目标展示，删除 retry 特例。
7. 运行 MCP、Server、Workspace 的完整质量门禁。
