# Agent 生图交互 验收报告

- 关联规划：`docs/plans/2026-07-07-agent-generation-interaction.md`
- 关联 PR：PR-A（Agent 接入生成 MCP）、PR-B（选择交互闭环）、PR-C（风格库与选片）
- 验收日期：＿＿＿＿（执行后填写）
- 验收人：＿＿＿＿
- 验收环境：macOS 桌面端（Electron），本地 server，Agent backend：Claude Code / codex / opencode 各至少一种；至少配置一个可用图片供应商（mediago 或 jimeng）

> 状态说明：本报告随规划一同产出，「实际结果 / 判定」两列在各 PR 实现完成后逐项执行并填写。判定取值：通过 / 不通过 / 阻塞 / 不适用。

## PR-A 实现进度（2026-07-08）

已实现并提交（commit `9c6bbb66`，基于合入 PR #20 的合并提交 `861b6148`）：

- `ResolveDocumentMCPServersForRun` 在文档 MCP 之外追加生成 MCP server：bridge 可用时 HTTP transport（`GenerationHTTPURL` 复用 bridge token 三 header），否则 stdio 回退（`mediago-generation-mcp --project`，二进制缺失时优雅跳过、文档 server 仍挂载）。
- 新增 `mediamcp.GenerationServerName`（`mediago_drama_generation`，与文档 server 分命名空间）与 `GenerationHTTPURL` 辅助函数。
- 指令层：TOOLS.md 增补「生成媒体」工作流段；`GenerationMCPInstructions` 补充 `generate_media` 返回 id 即 taskId。
- 顺带修复 PR #20 集成缺口：`isMCPAnyRoute` 跳过 generation-mcp 的非 POST `.Any` 变体（否则 swagger 覆盖测试失败）。

自动化验证结果：`packages/mcp` check（fmt+vet+lint+build+race test）通过；`packages/instructions` check 通过；`services/server` 的 vet / lint / 明码 build / `go test -race ./...`（含 acp 新单测、app 生成 MCP HTTP 集成测试、prompt golden）全部通过。唯一未过的是 `build:server` 的 `-tags workspace_dist` 步骤，因本 worktree 未构建前端 `dist/`（`pattern dist: no matching files found`）——环境问题，与本改动无关。

下表 A1–A7 的自动化可覆盖项已由单测/集成测试佐证；A2/A4/A5/A7 等需真实 Agent backend + 供应商的端到端项仍需在可运行环境中人工执行。

## 0. 前置门槛（每个 PR 合入前必须全绿）

| # | 检查项 | 命令 | 实际结果 | 判定 |
|---|---|---|---|---|
| Q1 | Go 静态检查 | `task check` | mcp / instructions / server 的 fmt+vet+lint 全绿；server 的 `build:server`（`-tags workspace_dist`）因缺前端 `dist/` 失败，与本改动无关 | 通过（除环境项） |
| Q2 | Go 测试（含 race） | `task test` | `services/server` `go test -race ./...` 全绿（swagger 预生成后）；mcp/instructions race test 全绿 | 通过 |
| Q3 | Go 编译 | `go build ./...` | mcp / server 明码 build 通过 | 通过 |
| Q4 | 前端 lint / 格式 / 构建 | `pnpm lint && pnpm format && pnpm build` | PR-A 无前端改动 | 不适用 |
| Q5 | OpenAPI 与新增 REST 路由同步，Swagger UI 可见 | 访问 `/api/docs` | swag 重新生成，6 条 generation-mcp POST 路由已在 spec 中；覆盖测试通过 | 通过 |

## 1. PR-A：Agent 接入生成 MCP

| # | 场景 | 步骤 | 预期结果 | 实际结果 | 判定 |
|---|---|---|---|---|---|
| A1 | 工具可见 | 启动 Agent 会话，观察 MCP `tools/list`（或让 Agent 自述可用工具） | 出现 `list_generation_models`、`generate_media` 等 6 个生成工具，document 工具不受影响 | 集成测试 `TestInternalGenerationMCPHTTPAuthAndTools` 断言 6 个工具全部列出 | 通过（自动化） |
| A2 | HTTP transport 优先 | 正常启动（bridge 可用），查看服务端日志 | 生成 MCP 以 HTTP transport 配置，URL 指向 `/api/v1/internal/agent/generation-mcp?projectId=...`，带 bridge token | 单测 `TestGenerationMCPServerMountedOverHTTP`：第二个 server 为 generation HTTP，URL 含 GenerationHTTPPath + projectId，带 bridge auth header，不泄漏 token | 通过（自动化） |
| A3 | stdio 回退 | 构造 bridge 不可用场景（或单测覆盖） | 回退到 `mediago-generation-mcp --project <id>` stdio 配置 | 单测 `TestGenerationMCPServerMountedOverStdio` + `...SkippedWhenBinaryMissing`（缺二进制时仅挂文档 server） | 通过（自动化） |
| A4 | 模型目录 | 对话：「有哪些可用的生图模型？」 | Agent 调 `list_generation_models` 并复述 routeId / configured 状态，不臆造 | 需真实 Agent backend | 待人工 |
| A5 | 端到端生图 | 对话：「用 ×× 模型生成一张 ×× 图片」 | Agent 提交 `generate_media` → `poll_generation_task` 至完成；生成工作台出现同一任务与资产 | 需真实 Agent backend + 供应商 | 待人工 |
| A6 | 项目越权拒绝 | Agent 传入非当前项目的 projectId（或单测覆盖） | 工具返回 scope 错误，任务未创建 | PR #20 单测 `TestGenerationServerRejectsProjectScopeOverrides`（4 处 projectId 来源全覆盖） | 通过（自动化） |
| A7 | 供应商未配置 | 清空供应商 API Key 后要求生图 | Agent 依据 `configured=false` 提示用户配置，不发起生成 | 服务端 `configured` 字段已由目录返回；Agent 行为需真实 backend 验证 | 待人工 |

## 2. PR-B：选择交互闭环（ask_user_selection）

### PR-B 服务端地基进度（2026-07-08）

已实现并通过测试（新建独立 `selection` 包，不泛化 approval）：

- 数据层：`domain.AgentSelectionModel` + `agent_selections` 表（AutoMigrate）；`AgentSelectionRepository`（Create / Get / ListPending / DecidePending 仅 pending 可决 / ExpirePending 仅 pending 可扫）。
- 服务层：`internal/service/selection`。`Create`（校验选项、去重、生成 id、写 `expires_at = now + RetrieveTTL(30min)`）、`Get`、`ListPending`（先机会性扫描过期）、`Decide`（optionId / customText / cancelled → selected / custom / cancelled；未知选项或 customText 越权报错；已决定则幂等返回）、`WaitForSelection`（阻塞：clamp [30s,10min] 默认 3min；超时返回 `ErrWaitTimeout` 且记录仍 pending；父 ctx 取消返回 `ctx.Err()`）。
- REST：`GET /projects/{projectId}/agent/selections`、`GET .../selections/{selectionId}`（事后取回）、`POST .../selections/{selectionId}/decision`；OpenAPI 注解 + 路由注册 + app 接线。
- 测试（`store_test.go`，含 -race）：选中/自定义/取消、非法决定拒绝且保持 pending、双击幂等、not-found、Wait 被决定唤醒、Wait 超时后仍可事后取回、ctx 取消、过期扫描、ClampTimeout 边界。

自动化验证：`services/server` `go vet` / `go build` / `go test -race ./...` 全绿；`golangci-lint` 对新包无告警；swagger 已含 3 条 selection 路由，`TestDevelopmentDocsRoutes` 覆盖检查通过。

### PR-B MCP 工具 + A2UI 卡片进度（2026-07-08）

已实现并通过测试（第 2 层，纯服务端）：

- MCP 契约（`packages/mcp`）：`AskUserSelectionInput/Output` + `SelectionOptionInput`；`AgentDocumentTools.AskUserSelection`（tool 名 `ask_user_selection`）；`AgentMCPInstructions` 补说明。
- 注册：`v2.Dispatcher` 与 `server.DocumentServices` 加 `AskUserSelection`（挂在 run-scoped document server，携带 sessionID/runID）；`registerSelectionTools` 注册；测试 stub 补齐。
- A2UI 卡片（`agent_a2ui.go`）：`a2uiImage` helper、`AgentA2UIActionSelection` 常量、`BuildSelectionA2UI`（每选项 Image(smallFeature)+标题+按钮 + 取消/自定义按钮，最多 8 项，确定性构建）。
- 适配器（`app/mcp/selection.go`）：`Adapter.AskUserSelection` — create selection → 沿 `event.A2UI`（AgentUIEventType）推卡片到时间线 → `WaitForSelection` 阻塞 → 映射 `selected/custom/cancelled/timeout`；ctx 取消返回错误。selection.Service 经 `WorkspaceStateService.Selections` 暴露（HTTP/stdio 两模式都从各自 workspace 仓库构建）。
- Agent 指令：TOOLS.md 生成段补充"风格选择/结果多选用 ask_user_selection 确认，timeout/cancelled 不擅自生成"。
- 测试（`selection_test.go`，含 -race）：selected 输出 + A2UI 卡片推送（带 session/run 上下文）、cancelled、空选项拒绝且不推卡、ctx 取消报错。文档 server 工具列表新增 `ask_user_selection`。

自动化验证：`packages/mcp` check（fmt+vet+lint+build+race test）全绿；`services/server` 默认 `go test -race ./...` 全绿、vet/lint/build 通过、prompt golden 已更新。

> 预存问题（与本改动无关）：`-tags integration` 下 `TestInternalDocumentMCPHTTPAuthAndComments` 与 `TestExternalMCPHTTPCommentLifecycle` 在 initialize instructions 片段断言处失败（要求 `不要把整篇内容一次性放进单个 write/edit 工具调用`，该片段在 dev / PR #20 的 MCP instructions 中从未存在）。默认 `go test` 不含 integration tag，故 CI 未跑到；本 PR 仅修正了其中 document 工具列表断言以纳入 `ask_user_selection`。生成 MCP 的 integration 测试通过。

### PR-B 前端进度（2026-07-08，第 3 层完成）

已实现并通过测试：

- 类型 + API：`AgentSelection` 等类型（`api/types/agent.ts`）；`listAgentSelections` / `decideAgentSelection`（`domains/agent/api/agent.ts`）。
- 动作处理（`a2ui-actions.ts`）：`kind === "agent_selection"` → decide → `replaceMessage` 终态（「已选择：×××」）；decide 幂等——点击已决定/过期的卡片按服务端返回的真实状态显示结果（选中/自定义/取消/已过期），不重复提交；信息不完整时记录错误且不调 API。
- 时间线（`AgentTimeline.tsx`）：`agent_selection` 加入 dismiss + keep-result 白名单（卡片被替换为结果消息而非移除，也不会落入"转发给 Agent"的兜底分支）。
- 样式（`AgentA2UIMessage.tsx`）：`[&_img]` 约束（圆角/边框/max-h-40/object-cover），选项预览图不撑爆卡片。
- 刷新恢复：确认服务端 `agent_event_projection` 已把 `agent.ui` 事件（含 A2UI payload）持久化进会话历史，刷新后卡片自动还原；action context 自带 projectId/selectionId，还原后的卡片点击仍可 decide。与权限卡/审批卡同机制，无需新增同步组件。
- 测试：a2ui-actions 新增 3 例（选中替换、过期幂等展示、不完整拒绝）；`AgentA2UIMessage` 新增渲染测试——用与服务端 `BuildSelectionA2UI` 相同形状的 payload 验证图片渲染 + 点击动作携带正确 context（两端契约对上）。agent 域 28 个测试文件 169 例全绿。

自动化验证：`pnpm lint`（0 警告）/ `pnpm format` / `pnpm build`（tsc + vite）全绿。

> 预存问题（与本改动无关）：`GenerationModalShell.test.tsx` 与 `ImageGenerationSpecControl.test.tsx` 各 1 例在合并基线 `861b6148`（本工作开始前）即以相同方式失败，属 dev 侧生成弹窗组件的既有问题，本改动未触碰这两个组件。

下表 B1–B9：B1 卡片渲染（含图片）与点击动作由前端渲染测试 + adapter 推送测试覆盖；B2 selected、B3 双击幂等、B4 自定义、B5 超时哨兵+可取回、B6 取消、B7 刷新恢复机制均已由自动化覆盖对应语义；端到端真机走查（真实 Agent backend 触发）仍待人工执行。

| # | 场景 | 步骤 | 预期结果 | 实际结果 | 判定 |
|---|---|---|---|---|---|
| B1 | 卡片出现 | Agent 调 `ask_user_selection`（含 4 个带图选项） | 时间线出现 A2UI 图片网格卡片：每项预览图 + 标题 + 按钮；明暗主题下均可读 | | |
| B2 | 选择恢复运行 | 点击某选项 | 卡片替换为「已选：×××」终态；阻塞的工具调用返回该 optionId；Agent 在同一 run 内继续后续步骤 | | |
| B3 | 防重复点击 | 快速双击同一/不同选项 | 仅第一次生效；二次 decide 被拒绝（仅 pending 可决），前端无报错弹出 | | |
| B4 | 自定义回复 | 点击「都不满意，我来描述」 | 工具返回 `status=custom`；Agent 转为在对话中询问用户描述 | | |
| B5 | 超时 | 不做任何操作直至 `timeoutSeconds` 到期 | 工具返回 `status=timeout`；selection 标记 expired；Agent 说明情况并结束回合，不擅自生成 | | |
| B6 | run 中止取消 | 等待期间停止 Agent run | selection 标记 cancelled；卡片进入终态，点击无效果且有明确提示 | | |
| B7 | 刷新恢复 | 卡片出现后刷新页面 | pending selection 经 REST 列表恢复渲染，点击仍可完成决定 | | |
| B8 | REST 幂等与校验 | 直接调 decision 接口：非法 selectionId / 已决定 / 缺 optionId | 分别返回 404 / 409（或明确错误）/ 400，均不影响服务 | | |
| B9 | 回归：既有卡片 | 触发 ACP 权限确认、危险文档操作确认 | 两类既有卡片行为与样式不变 | | |

## 3. PR-C：风格推荐与结果选片

### PR-C 实现进度（2026-07-08）

已实现并通过测试：

- 风格 preset 目录：`configs/style-presets/`（manifest.json + 8 张 SVG 预览图，go:embed 打包）；`StylePresetStore`（照 voice preview 模式：manifest 校验含未知 routeId / 重复 id / 路径逃逸拒绝，缺 manifest 视为空目录）。预览图为调色板风格占位 SVG，设计侧有真图后替换文件即可。
- 暴露：`ListGenerationModels` 响应新增 `stylePresets`（id/title/kinds/promptSuffix/params/previewUrl）；预览图经 `GET /api/v1/generation/style-previews/{presetId}` 提供（immutable 缓存头）；MCP 合约 `GenerationModelsOutput.StylePresets` 同步。
- 选片工具：生成 MCP 新增 `select_generation_asset(taskId, slotIndex, title?)`，复用服务端 `UpdateGenerationTaskAsset`（slot 语义），带项目作用域校验；工具数 6→7。
- Agent 指令：TOOLS.md 固化「生图标准流程」四步（preset 推荐不实际生图 → 确认后拼 promptSuffix/params 生成 → 多张结果 ask_user_selection 选片 + select_generation_asset 标记 → 长任务 notificationTarget fire-and-forget 不阻塞轮询）；`GenerationMCPInstructions` 同步。
- 测试：`style_presets_test.go`（内置目录完整性、预览内容、6 种非法 manifest 拒绝、缺 manifest 为空）；`generation_test.go` 新增选片成功/缺槽位/缺任务/越权 4 例；集成测试工具列表更新为 7 个。

自动化验证：gofmt/vet/lint 全绿；`services/server` 全量 `go test -race ./...` 通过（含 swagger 覆盖检查，style-previews 路由已入 spec）；`packages/mcp` check 全绿；generation MCP 集成测试通过；prompt golden 已随 TOOLS.md 更新。

| # | 场景 | 步骤 | 预期结果 | 实际结果 | 判定 |
|---|---|---|---|---|---|
| C1 | 风格推荐零费用 | 对话：「帮我给角色配几种插画风格」 | Agent 从 preset 目录挑 4–8 项发选择卡片，预览图为内置资产；期间生成任务列表无新增任务（未扣费） | | |
| C2 | 确认后生成 | 在 C1 卡片选择一种风格 | Agent 按 preset 的 routeId/params/promptSuffix 提交 `generate_media`；任务参数与 preset 一致 | | |
| C3 | 结果选片 | 生成完成后 | Agent 发结果选片卡片（真实生成图）；选中后 `Selected`/`SlotIndex` 落库，生成工作台同步显示选中态 | | |
| C4 | 插入文档 | 选片完成后 | 选中资产以图片引用写入目标文档章节，文档中可见 | | |
| C5 | 长任务不阻塞 | 要求生成视频（慢路由） | Agent 走 fire-and-forget + `notificationTarget`，结束回合；完成后通知出现并可跳转 | | |
| C6 | 回归：手动生成 | 在生成工作台手动完整走一次生图 | 手动流程（含选片、重试）不受任何影响 | | |

## 4. 非功能验收

| # | 项 | 标准 | 实际结果 | 判定 |
|---|---|---|---|---|
| N1 | 阻塞等待兼容性 | 三种 Agent backend（Claude Code / codex / opencode）下，5 分钟内的等待均不被客户端掐断；如有 backend 不兼容，需记录并在指令中降级为转轮式 | | |
| N2 | 等待开销 | WaitForSelection 轮询间隔 1–2s，等待期间 CPU 无显著占用，无日志刷屏 | | |
| N3 | 数据清理 | expired/cancelled selection 不无限堆积（有清理或上限策略） | | |
| N4 | 卡片可达性 | 图片加载失败时选项仍可通过文字标题辨识并点击 | | |
| N5 | 并发 run | 两个项目各开一个 Agent run 同时发起选择，互不串卡、互不串决定 | | |

## 5. 验收结论

- PR-A：＿＿＿＿
- PR-B：＿＿＿＿
- PR-C：＿＿＿＿
- 遗留问题清单：＿＿＿＿
- 总体结论（通过 / 有条件通过 / 不通过）：＿＿＿＿
