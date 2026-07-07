# Agent 生图交互（生成 MCP + 用户确认）实现规划

## Goal

让内置 Agent 通过生成 MCP 自动生图，并以 oiioii 式的「推荐卡片 → 用户选择/确认 → 继续生成 → 结果选片」交互完成闭环。PR #20 已提供生成 MCP 能力层（`list_generation_models` / `generate_media` / `get_generation_task` / `list_generation_tasks` / `retry_generation_task` / `poll_generation_task`），本规划补齐 Agent 接线、交互层与呈现层。

## 现状与复用点

| 已有机制 | 位置 | 在本方案中的角色 |
|---|---|---|
| 生成 MCP server（HTTP + stdio） | `packages/mcp`、`services/server/internal/app/mcp/generation*.go`（PR #20） | 能力层，不改合约 |
| Agent MCP 接线 | `services/server/internal/service/acp/acp_mcp.go` `ResolveDocumentMCPServersForRun` | 追加第二个 MCP server 入口 |
| A2UI 卡片渲染 + 动作回传 | `agent_a2ui.go`、`AgentA2UIMessage.tsx`、`a2ui-actions.ts`；basicCatalog 含 `Image` 组件 | 选择卡片的呈现与点击 |
| 阻塞式确认先例 | `approval/store.go` `WaitForDocumentToolApproval`（轮询 DB）+ REST `/agent/document-tool-approvals/{id}/decision` | 选择等待机制照抄 |
| 时间线交互白名单 | `AgentTimeline.tsx`（`agent_permission` / `document_tool_approval`） | 新增 `agent_selection` |
| 内置预览资产先例 | `generation/voice_previews.go`（语音试听内置资产） | 风格预览图目录照此模式 |
| 结果选片字段 | `GenerationAsset.SlotIndex` / `Selected` | 生成后 4 选 1 |

## 总体设计

三层解耦：

1. **能力层**：生成 MCP（PR #20，project-scoped，无状态）。
2. **交互层**：通用 `ask_user_selection` 阻塞式 MCP 工具，挂在 run-scoped document MCP server 上（它携带 sessionID/runID，卡片才能落到正确的会话时间线）。不放进生成 MCP。
3. **呈现层**：A2UI 选择卡片由服务端确定性构建（`BuildSelectionA2UI`），禁止 LLM 直接输出 A2UI JSON。

关键取舍：

- **风格推荐不实时生图**。推荐网格用内置风格 preset 的预览图（零成本、即时）；真实调 `generate_media` 只发生在用户确认之后。
- **阻塞式（Wait + decide）为主**，Agent 同一 run 内完成全流程；超时返回哨兵值让 Agent 优雅收尾（转为转轮式：结束回合等用户消息）。
- **长任务（视频）不阻塞选片**：`generate_media` + `notificationTarget` fire-and-forget，结束回合，由现有通知链路呈现结果。

## Phase 1 — 生成 MCP 接入 Agent 运行时（PR-A）

1. `acp_mcp.go`：`ResolveDocumentMCPServersForRun` 的 Servers 追加生成 MCP：
   - HTTP 优先：`bridgeURL + mediamcp.GenerationHTTPPath + "?projectId=..."`，复用 bridge token 三个 header；server name 建议 `mediago-drama-generation`。
   - stdio 回退：查找 `mediago-generation-mcp` 可执行文件（复制 `documentMCPExecutable` 的候选路径逻辑），`--project` 参数。
2. Agent 主指令（`buildACPPrompt` / `packages/instructions`）补一段生成工作流指引：何时生图、先 `list_generation_models` 确认 `configured` 状态、`generate_media` 返回的 `id` 即 `taskId`。
3. 顺手改进 PR #20 遗留项：`GenerationMCPInstructions` 写明 id/taskId 等价；评估从 `GenerationMessageInput` 移除 `promptOptimization`（服务端恒忽略）。
4. 测试：`acp_mcp` 单测（两个 server、HTTP/stdio 两种 transport、projectID 非法时禁用）。

**验收锚点**：Agent 会话中 `tools/list` 可见 6 个生成工具；对话让 Agent 生一张图能产出任务并在生成工作台可见。

## Phase 2 — 通用 selection 服务端（PR-B 第一部分）

1. 数据模型 + migration：`agent_selections` 表——`id, project_id, session_id, run_id, kind, title, options_json, allow_custom, status(pending|decided|cancelled|expired), decision_json, created_at, decided_at, expires_at`。
2. repository：`CreateAgentSelection` / `GetAgentSelection` / `ListPendingAgentSelections` / `DecidePendingAgentSelection`（参照 `DecidePendingDocumentToolApproval` 的「仅 pending 可决」条件更新，防重复点击竞态）。
3. service（`internal/service/selection` 或并入 `approval` 包泛化）：`Create` / `Decide` / `WaitForSelection(ctx, interval)`（照抄 `approval/store.go:167` 轮询模式）+ 过期处理（`expires_at` 到点标记 `expired`）。
4. REST（照 `handlers/approvals.go`）：
   - `GET /api/v1/projects/{projectId}/agent/selections?status=pending`
   - `POST /api/v1/projects/{projectId}/agent/selections/{selectionId}/decision`（body：`optionId` 或 `customText` 或 `cancelled`）
5. A2UI：`agent_a2ui.go` 增加 `AgentA2UIActionSelection = "agent_selection.decide"` 与 `BuildSelectionA2UI`——Image 网格（每选项 Image + caption + Button），末尾附「都不满意，我来描述」按钮（`allow_custom` 时）；action context 携带 `kind/selectionId/optionId/projectId/sessionId`。
6. 卡片投递：创建 selection 时沿 agent 会话事件流推送 A2UI payload（参照 `acp_client_permission.go:94` → `agent_runtime.go` → `agent_event_projection.go` 的 `event.A2UI` 通道）；前端另有 REST pending 列表兜底（见 Phase 4）。

## Phase 3 — `ask_user_selection` MCP 工具（PR-B 第二部分）

1. `packages/mcp/pkg/mcp`：类型 `SelectionInput{title, options[{id,label,imageUrl,description}], allowCustom, timeoutSeconds}`、`SelectionOutput{status: selected|custom|cancelled|timeout, optionId, customText}`；`AgentDocumentTools` 增加 `AskUserSelection` 定义，描述写明**阻塞语义、超时返回值、每回合建议只调一次**。
2. `packages/mcp/internal/tools/v2`：注册到 run-scoped server（Dispatcher 接口加方法）。
3. `services/server/internal/app/mcp`：适配实现——create selection → 推卡片 → `WaitForSelection`（interval 1–2s；`timeoutSeconds` clamp 到 [30s, 10min]，默认 5min）→ 映射输出。ctx 取消（run 中止）时标记 selection cancelled。
4. stdio document MCP 模式说明：wait 轮询共享 SQLite，decide 由主服务器 REST 写入，跨进程可用；但 stdio 进程推不了 agent 事件，卡片依赖前端 REST pending 兜底渲染——写入文档即可，不阻塞本期。
5. 测试：adapter 单测（选择/超时/取消/自定义四条路径，stub selection service）。

## Phase 4 — 前端（PR-B 第三部分）

1. `api/types/agent.ts` + `domains/agent/api/agent.ts`：`AgentSelection` 类型、`listAgentSelections` / `decideAgentSelection`。
2. `a2ui-actions.ts`：`kind === "agent_selection"` handler——decide 成功后 `replaceMessage` 把卡片换成「已选：×××」终态（照 permission handler），防重复点击。
3. `AgentTimeline.tsx` 交互 kind 白名单加 `agent_selection`。
4. Pending 兜底同步组件（照 `AgentPermissionNotificationSync` / `PendingPermissionRequests`）：页面刷新或 stdio 场景下，从 REST pending 列表恢复渲染选择卡片。
5. `AgentA2UIMessage.tsx` 补图片网格样式约束（`[&_img]` 圆角、object-fit、最大宽度、多列布局）。
6. 测试：a2ui-actions 单测 + AgentTimeline 渲染测试。

## Phase 5 — 风格 preset 目录 + Agent 工作流指令（PR-C 第一部分）

1. 风格库：`StylePreset{id, title, previewURL, kinds, routeId, paramsTemplate, promptSuffix}`；内置 JSON 目录 + 预览图资产（照 `voice_previews.go` 内置资产模式，预览图静态打包，经本地资产 URL 暴露）。
2. MCP 暴露：`GenerationModelsOutput` 增加 `stylePresets` 字段（合约向后兼容，新增可选字段；不必新开工具）。
3. Agent skill / 指令固化工作流：
   - 收到生图诉求 → `list_generation_models` 取目录 + presets；
   - 挑 4–8 个匹配的 preset，用 `ask_user_selection`（imageUrl=预览图）让用户选风格；
   - 用户确认 → 按 preset 的 routeId/params/promptSuffix 组装 `generate_media`；
   - `status=submitting|submitted` → `poll_generation_task` 直至完成；
   - 超时/取消 → 说明情况并结束回合，不擅自生成。

## Phase 6 — 结果选片与文档插入（PR-C 第二部分）

1. 生成完成后，Agent 用 `ask_user_selection` 展示结果资产（imageUrl=`GenerationAsset.URL`，一次通常 1–4 张）。
2. 选片落库：生成 MCP 增加轻量工具 `select_generation_asset(taskId, slotIndex)`（写 `Selected` 字段，复用现有服务端选片逻辑）。
3. 插入文档：Agent 经既有 document MCP 写工具将选中资产以 markdown 图片引用写入目标章节。
4. 长任务（视频/慢供应商）：指令要求改用 `notificationTarget` fire-and-forget，不阻塞选片。

## PR 拆分与依赖

- **PR-A**（Phase 1）：独立可合，立即让 Agent 具备生图能力（无确认交互，先由权限确认卡兜底）。
- **PR-B**（Phase 2+3+4）：交互闭环，依赖 PR-A 合入 dev。
- **PR-C**（Phase 5+6）：体验完善，依赖 PR-B。

## 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| ACP backend（Claude Code/codex）对长时间无输出的 MCP 工具调用有自身超时 | 阻塞等待被客户端掐断 | `timeoutSeconds` 默认 5min 且可配；实测各 backend 容忍度；超时哨兵让 Agent 转为转轮式收尾。`DefaultAgentRunTimeout=0`（服务端不设墙钟），瓶颈只在客户端 |
| 用户长期不响应导致 selection 堆积 | pending 泄漏 | `expires_at` + 定期清理；卡片终态替换 |
| LLM 生成 A2UI JSON 不可控 | 渲染错误/注入 | A2UI 只由服务端确定性构建，工具输入是纯数据 options |
| 推荐阶段实时生图产生费用/延迟 | 成本失控 | preset 预览图内置，仅确认后才 `generate_media`；指令中明示 |
| stdio 生成 MCP 双进程状态（PR #20 review 已提出） | 通知/轮询归属混乱 | 产品内主推 HTTP transport（PR-A 即 HTTP 优先）；stdio 定位为外部客户端场景并文档化 |
| decide 竞态（双击/多端） | 重复决定 | repository 层「仅 pending 可决」条件更新，二次 decide 返回明确错误 |

## 质量门槛

每个 PR 合入前：`task check`、`task test`（`go test -race ./...`）、`go build ./...`、`pnpm lint`、`pnpm format`、`pnpm build`；OpenAPI（`api/openapi.yaml`）同步新增 REST 路由。
