# Agent Generation MCP Tool Pruning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Agent Generation MCP 从 8 个工具收缩为 `generate_media` 和 `generate_media_batch`，删除不可达的 Agent 重试协议，同时保留 HTTP、工作台、后台任务和创建确认安全边界。

**Architecture:** MCP 只承担“已确认请求的单项或批量提交”。模型目录由统一设置表单通过 HTTP 获取，任务查询、重试、轮询和选片继续由工作台及后台服务承担。创建用 `generation_plan` 的 intent、single-use claim、指纹和结果重放保持不变；`generation_retry_plan` 及其专属代码完整删除。

**Tech Stack:** Go、MCP Go SDK、Gin/Gorm 服务层、React 19、TypeScript、Vitest、go-task。

---

### Task 1: 用失败测试锁定两个工具的公开契约

**Files:**
- Modify: `packages/mcp/pkg/server/server_test.go`
- Modify: `packages/mcp/pkg/mcp/mcp_test.go`
- Modify: `services/server/internal/app/mcp/http_integration_test.go`

**Step 1: 修改 tools/list 断言**

将 package server 和 HTTP 集成测试中的期望列表改为：

```go
assertMCPTools(t, tools,
    "generate_media",
    "generate_media_batch",
)
```

新增负向断言，确保六个旧名称均不存在。

**Step 2: 收缩 schema/description 测试**

删除 `retry_generation_task`、`get_generation_task`、`poll_generation_task` schema 检查，以及旧 `GenerationTools` 字段描述检查。保留：

```go
assertMCPToolProperties(t, toolSchemas, "generate_media", "confirmationSelectionId", "prompt")
assertMCPToolProperties(t, toolSchemas, "generate_media_batch", "confirmationSelectionId", "items")
```

**Step 3: 验证测试先失败**

Run: `go test ./pkg/server ./pkg/mcp`
Working directory: `packages/mcp`
Expected: FAIL；server 仍注册 8 个工具。

Run: `go test ./internal/app/mcp -run 'TestInternalGenerationMCPHTTPAuthAndTools|TestGenerationMCP'`
Working directory: `services/server`
Expected: FAIL；HTTP tools/list 仍返回旧工具。

---

### Task 2: 收缩 MCP 注册、公共定义和 DTO

**Files:**
- Modify: `packages/mcp/internal/tools/generation/register.go`
- Modify: `packages/mcp/pkg/server/store.go`
- Modify: `packages/mcp/pkg/mcp/tools.go`
- Modify: `packages/mcp/pkg/mcp/generation_types.go`
- Delete or trim: `packages/mcp/pkg/mcp/generation_catalog_contract_test.go`
- Modify: `packages/mcp/pkg/mcp/mcp_test.go`

**Step 1: 缩减 Dispatcher 和 Register**

`Dispatcher` 只保留：

```go
CreateGenerationMessage(ctx context.Context, projectID string, input mediamcp.GenerationMessageInput) (mediamcp.GenerationMessageOutput, error)
CreateGenerationBatch(ctx context.Context, projectID string, input mediamcp.GenerationBatchInput) (mediamcp.GenerationBatchOutput, error)
```

`Register` 只注册 `GenerationTools.Generate` 和 `GenerationTools.GenerateBatch`。

**Step 2: 同步公共 server 接口**

从 `packages/mcp/pkg/server/store.go` 的 `GenerationDeps` 删除六个旧方法。

**Step 3: 收缩工具定义和 instructions**

`GenerationTools` 只保留 `Generate`、`GenerateBatch`。重写 `GenerationMCPInstructions`，只说明统一确认、单项/批量提交、提交即结束和后台履约。

将 `generate_media` 描述中的“参数来自 list_generation_models”改成“图片/视频 routeId、params、参考资产和提示词设置必须原样来自已提交的 generation_settings”。

**Step 4: 删除六个工具专属 DTO**

从 `generation_types.go` 删除：

- `GenerationListModelsInput`、`GenerationModelsOutput`
- `GenerationVoicePreviewAsset`、`GenerationPreferences`
- `GenerationSelectAssetInput`
- `GenerationTaskInput`、`GenerationRetryTaskInput`、`GenerationTaskListInput`
- `GenerationTaskRecord`、`GenerationTaskAttemptRecord`、`GenerationTasksOutput`

保留 `GenerationAsset`、`GenerationUsage` 和全部创建/批次 DTO。

**Step 5: 运行 MCP 测试**

Run:

```bash
gofmt -w internal/tools/generation pkg/mcp pkg/server
go test -race ./...
```

Working directory: `packages/mcp`
Expected: PASS；tools/list 只含两个工具。

---

### Task 3: 删除 Server 旧 MCP handler 和重试授权实现

**Files:**
- Modify: `services/server/internal/app/mcp/generation_server.go`
- Modify: `services/server/internal/app/mcp/generation.go`
- Modify: `services/server/internal/app/mcp/generation_convert.go`
- Delete: `services/server/internal/app/mcp/generation_retry_confirmation.go`
- Modify: `services/server/internal/app/mcp/generation_test.go`
- Modify: `services/server/internal/app/mcp/generation_confirmation_test.go`
- Modify: `services/server/internal/app/mcp/http_integration_test.go`

**Step 1: 先确认创建授权回归测试仍覆盖**

- Agent mode 缺失 session/run/selection store 时 fail closed；
- intent、route、params、参考资产、技能包不一致时拒绝；
- selection 只能 claim 一次；
- 同指纹结果可重放；
- 不同指纹和处理中状态不得重复触发供应商；
- trusted manual mode 仍可调用两个保留工具。

删除只覆盖 MCP retry claim/outcome 的测试。

**Step 2: 收缩 MCP GenerationService interface**

删除 `ListGenerationModels`、`RetryGenerationTask`、`ListGenerationTasks`、`GetGenerationTask`、`PollGenerationTask`、`UpdateGenerationTaskAsset`、`GenerationPreferenceForProject`。

不要删除 `services/server/internal/service/generation` 中的同名底层能力。

**Step 3: 删除 handler/helper**

从 `generation.go` 删除：

- `ListGenerationModels` 和模型过滤 helper
- `GetGenerationTask`、`ListGenerationTasks`
- `RetryGenerationTask` 及失败完成 helper
- `PollGenerationTask`、`SelectGenerationAsset`
- 仅供上述方法使用的 task ID、可见性和 service helper

保留 create single/batch、project ID 归一化、claim/complete 和错误封装。

**Step 4: 删除转换和 retry 文件**

删除模型目录、偏好、任务列表、任务记录、attempt 的 MCP 转换函数；保留 request、batch、message、asset、usage 转换。删除整个 `generation_retry_confirmation.go`。

**Step 5: 精简测试 stubs 并运行**

Run:

```bash
gofmt -w internal/app/mcp
go test -race ./internal/app/mcp
```

Working directory: `services/server`
Expected: PASS；create single/batch 安全测试仍通过，旧工具不可见。

---

### Task 4: 从 selection 协议移除 Agent retry plan

**Files:**
- Modify: `packages/mcp/pkg/mcp/selection_types.go`
- Modify: `packages/mcp/pkg/mcp/selection_test.go`
- Modify: `packages/mcp/pkg/mcp/tools.go`
- Modify: `packages/mcp/pkg/server/server_test.go`
- Modify: `services/server/internal/service/selection/types.go`
- Modify: `services/server/internal/service/selection/store.go`
- Modify: `services/server/internal/service/selection/store_test.go`
- Modify: `services/server/internal/repository/agent_selection_repo.go`
- Modify: `services/server/internal/repository/agent_selection_repo_test.go`
- Modify: `services/server/internal/app/mcp/selection.go`
- Modify: `services/server/internal/app/mcp/selection_test.go`

**Step 1: 先定义新的失败测试**

调整 schema/reflection 测试，要求 intent item 不再包含 `RetryTaskID`。调整 validation table，使 `operation: "retry"` 被拒绝，只接受 `create_single` 和 `create_batch`。删除 retry plan 正向测试。

**Step 2: 删除公共 retry intent**

删除 `RetryTaskID`，并将 `AskUserSelectionInput.Intent` 描述恢复为创建确认或通用选择，不再声明 retry 特例。

**Step 3: 删除 selection service retry 分支**

删除：

- `KindGenerationRetryPlan`
- `GenerationRetryConfirmOptionID`
- retry operation 常量
- `normalizeGenerationRetryTaskID`
- retry intent 字段白名单
- retry fields/options/decision 校验
- retry selection claim authorization

`ClaimGenerationUse` 和 `validatedGenerationSelectionContract` 只接受 `KindGenerationPlan`；保留 CAS、fingerprint、outcome 和 submitted form validation。

**Step 4: 删除 adapter/repository 特例**

从 `selection.go` 删除固定重试卡逻辑。从 repository claim 条件删除 `generation_retry_plan`，只允许 `generation_plan`。

**Step 5: 运行测试**

Run: `go test -race ./pkg/mcp ./pkg/server`
Working directory: `packages/mcp`

Run: `go test -race ./internal/service/selection ./internal/repository ./internal/app/mcp`
Working directory: `services/server`

Expected: PASS；create plan single-use/重放保留，retry plan 不再是协议。

---

### Task 5: 更新 Agent 指令、Skill 和前端 intent 类型

**Files:**
- Modify: `packages/instructions/pkg/official/assets/instructions/TOOLS.md`
- Modify: `packages/instructions/pkg/official/official_test.go`
- Modify: `packages/instructions/pkg/pack/builtin/assets/skills/image-generation.skill.md`
- Modify: `packages/instructions/pkg/pack/builtin/assets/skills/video-generation.skill.md`
- Modify: `packages/instructions/pkg/pack/builtin/builtin_test.go`
- Modify: `services/server/internal/service/prompt/testdata/*.golden`
- Modify: `services/server/internal/service/prompt/prompt_workspace_test.go`
- Modify: `services/server/internal/app/mcp/read_test.go`
- Modify: `apps/workspace/src/api/types/agent.ts`
- Modify: `apps/workspace/src/domains/agent/components/timeline/AgentGenerationIntentSummary.tsx`
- Modify: related frontend tests as required

**Step 1: 先更新指令测试**

要求：

- 包含 `generate_media`、`generate_media_batch`
- 包含 `generation_plan`、`generation_settings`、提交即结束
- 不包含六个旧工具名
- 不包含 `generation_retry_plan`、`confirm_retry`、`retryTaskId`
- 图片/视频 Skill 不再要求先查 MCP 模型目录

**Step 2: 重写主指令和 Skill**

工具清单只列两个提交工具。删除音频“先查目录”、任务查询/轮询、Agent retry plan 和旧工具禁用列表。

图片/视频流程改成：锁定目标 → 打开统一表单 → 用户确认 → 原样提交 → 结束。无 default 时由表单恢复偏好；显式参数由表单基于实时 HTTP 目录校验。删除后续 run 重试章节。

**Step 3: 同步 golden 和 prompt tests**

更新四个 prompt golden，以及 `prompt_workspace_test.go`、`read_test.go` 的字符串断言，使用正向规则“提交后由后台和工作台承接”。

**Step 4: 删除前端 retry 字段**

从 `agent.ts` 删除 `retryTaskId`；从 `AgentGenerationIntentSummary.tsx` 删除其摘要特例。保留所有 create intent 展示。

**Step 5: 运行目标测试**

Run: `go test -race ./pkg/official ./pkg/pack/builtin`
Working directory: `packages/instructions`

Run: `go test -race ./internal/service/prompt ./internal/app/mcp`
Working directory: `services/server`

Run:

```bash
pnpm test -- src/domains/agent/components/timeline/AgentFormCard.test.tsx src/domains/agent/components/timeline/AgentFormGenerationSettings.test.tsx
pnpm build
```

Working directory: `apps/workspace`

Expected: PASS；统一表单仍自行加载目录，前端不再包含 retry intent。

---

### Task 6: 对齐当前暂存 ADR/计划并做残留审计

**Files:**
- Modify: `docs/adr/0001-intent-bound-agent-generation-authorization.md`
- Modify: `docs/plans/2026-07-16-agent-generation-confirmation-hardening.md`
- Keep current: `docs/plans/2026-07-16-agent-generation-mcp-tool-pruning-design.md`
- Keep current: `docs/plans/2026-07-16-agent-generation-mcp-tool-pruning.md`

**Step 1: 更新未提交 ADR**

将范围改成“Agent 创建图片/视频任务”。删除重试授权章节，明确 HTTP 重试能力与工作台/后台任务边界独立于 Agent MCP。

**Step 2: 更新未提交 hardening 计划**

删除 retry plan、retry MCP adapter 和 retry acceptance；保留 create single/batch intent、claim、fingerprint、outcome、fail-closed。

**Step 3: 扫描残留**

Run:

```bash
rg -n 'list_generation_models|get_generation_task|list_generation_tasks|retry_generation_task|poll_generation_task|select_generation_asset|generation_retry_plan|confirm_retry|retryTaskId' \
  packages/mcp packages/instructions services/server apps/workspace/src \
  --glob '!**/*_test.go'
```

Expected: 生产代码、golden 和活跃指令中无旧 MCP 工具名或 Agent retry 协议残留。测试可以保留旧名称作为负向契约断言；底层 Go service 的普通 Retry/Poll 方法允许保留。

**Step 4: 审查删除边界**

Run:

```bash
git diff --cached --stat
git diff --cached -- services/server/internal/http services/server/internal/service/generation apps/workspace/src/domains/generation
```

Expected: HTTP routes、`PollPendingGenerationTasks`、工作台任务查询/选片，以及 HTTP retry endpoint 和前端 API wrapper 仍存在；不要求当前 UI 已接线重试按钮。

---

### Task 7: 完整质量门禁与人工验收

**Step 1: MCP**

Run: `task check`
Working directory: `packages/mcp`
Expected: fmt、vet、lint、build、race tests PASS。

**Step 2: Server**

Run: `task check`
Working directory: `services/server`
Expected: swagger、fmt、vet、lint、build、race tests PASS。

**Step 3: Workspace**

Run:

```bash
pnpm lint
pnpm format
pnpm test
pnpm build
```

Working directory: `apps/workspace`
Expected: 全部 PASS。

**Step 4: 根工作区**

Run: `task check`
Working directory: repository root
Expected: 全部 PASS。

**Step 5: 人工验收**

1. Agent generation MCP tools/list 只出现 `generate_media` 和 `generate_media_batch`。
2. 图片/视频 `generation_settings` 卡片仍能加载实时模型、configured route、偏好、参数、参考资产和技能包。
3. 单项、批次各提交一次，确认 single-use、结果重放和后台通知正常。
4. 在生成工作台确认任务查询、后台轮询和选片仍可用；通过测试确认 HTTP retry endpoint 与前端 wrapper 仍保留，不宣称当前已有重试按钮。
