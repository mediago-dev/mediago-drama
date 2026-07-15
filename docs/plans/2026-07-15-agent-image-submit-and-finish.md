# Agent 图片提交即结束 Implementation Plan

> 后续扩展：同日的视频实施计划已把相同终止边界扩展到视频；本文中“视频保持现状”的表述仅记录图片阶段的原始范围。

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Agent 在图片生成任务被服务端接受后立即结束当前 run，不再等待图片完成、选片或回写。

**Architecture:** 保留现有异步图片服务、后台 worker、完成事件和项目资源首图自动选中，只修改 Agent 的三层运行时契约。内置图片 Skill 描述正常流程，官方 TOOLS 指令消除通用轮询冲突，Generation MCP instructions 和生成工具描述提供不可被旧 Skill 覆盖的硬边界。

**Tech Stack:** Go、MCP、Markdown prompt/Skill、Go testing、prompt golden snapshots。

---

## 已确认范围

- 只改变图片 Agent 流程；视频等其他媒体保持现状。
- 单次和批次图片请求在获得已接受的 `taskId` 后都立即结束当前 run。
- 同一 run 不查询、轮询、重试、选片或执行依赖最终图片的文档回写。
- 项目资源继续依赖 `documentContext`、服务端首图自动选中与完成通知。
- MCP 查询与选片工具继续注册，供后续独立请求和其他媒体流程使用。
- 不在本次增加后台失败通知、SSE replay 或 Agent 自动续跑。

### Task 1: 用测试锁定图片提交即结束契约

**Files:**
- Modify: `packages/instructions/pkg/pack/builtin/builtin_test.go`
- Modify: `packages/instructions/pkg/official/official_test.go`
- Modify: `packages/mcp/pkg/mcp/mcp_test.go`
- Modify: `services/server/internal/app/mcp/read_test.go`
- Modify: `services/server/internal/service/prompt/prompt_workspace_test.go`

**Step 1: 更新图片 Skill 契约测试**

让 `TestImageGenerationSkillOwnsAgentImageWorkflow` 要求 Skill 明确包含：

- 图片任务提交成功后立即结束当前 run；
- 单次报告 `taskId`，批次报告批次 ID 和子任务 ID；
- 当前 run 不调用 get/list/poll/retry/select 工具；
- 后台完成由服务端和通知链路负责。

同时禁止旧阶段标题“等待任务完成”和同一 run 的结果选片/文档回写规则。

**Step 2: 更新官方 TOOLS 契约测试**

新增断言，要求图片专属规则明确“提交后结束”，并确保不再存在对所有媒体统一要求 `poll_generation_task` 直到完成的文案。

**Step 3: 更新 MCP 硬边界测试**

要求 `GenerationMCPInstructions`、`Generate` 与 `GenerateBatch` 工具描述都包含图片提交即结束规则；查询/轮询/选片工具仍存在，但必须说明不能用于当前图片提交 run 的后处理。

同时让 server 测试验证：通过 `load_skill` 读取到的内置图片 Skill，以及最终拼装出的 Agent system prompt，都包含相同终止边界。

**Step 4: 运行测试确认旧行为失败**

Run:

```bash
cd packages/instructions && go test ./pkg/pack/builtin ./pkg/official -count=1
cd packages/mcp && go test ./pkg/mcp -count=1
```

Expected: FAIL，指出旧 Skill/TOOLS/MCP instructions 仍要求图片轮询、选片或回写。

### Task 2: 改写内置图片 Skill 和官方 TOOLS

**Files:**
- Modify: `packages/instructions/pkg/pack/builtin/assets/skills/image-generation.skill.md`
- Modify: `packages/instructions/pkg/official/assets/instructions/TOOLS.md`
- Modify: `README.md`

**Step 1: 收窄 Skill 职责**

- frontmatter 与核心边界改为负责目标、设置和提交。
- 把“等待任务完成”改为“确认提交并结束”。
- 说明单次/批次接受条件与 final answer 内容。
- 明确禁止当前 run 调用任务查询、轮询、重试、选片工具。
- 删除生成后选片和文档回写阶段；说明项目资源由服务端首图自动选中，其他后处理留给后续操作。

**Step 2: 修正 TOOLS 媒体分流**

- 图片 `submitting/submitted/running` 表示后台任务，报告 ID 后结束。
- 视频和用户后续明确查询仍可使用任务查询/轮询工具。
- 最终回复规则区分图片提交结果与其他媒体最终结果。

**Step 3: 同步 README 能力描述**

把 `image-generation` 从“任务轮询与选片回写”改为“异步任务提交与后台通知”，避免产品文档继续宣传旧流程。

**Step 4: 重跑 instructions 测试**

Run:

```bash
cd packages/instructions && go test -race ./...
```

Expected: PASS。

### Task 3: 在 Generation MCP 固化不可覆盖的图片终止边界

**Files:**
- Modify: `packages/mcp/pkg/mcp/tools.go`
- Modify: `packages/mcp/pkg/mcp/mcp_test.go`

**Step 1: 更新 GenerationMCPInstructions**

明确：

- 图片单次/批次请求被接受并返回任务 ID 后，当前 Agent run 已完成；
- 当前 run 不得继续 get/list/poll/retry/select、结果选择或文档回写；
- 这些工具只用于其他媒体流程或用户后续明确发起的独立操作。

**Step 2: 更新工具描述**

- `generate_media` 和 `generate_media_batch` 直接提示图片提交后的终止语义。
- Get/List/Poll/Retry/Select 描述增加“不得用于刚提交图片的同一 Agent run”边界，同时保持工具注册和 API 不变。

**Step 3: 重跑 MCP 测试**

Run:

```bash
cd packages/mcp && go test -race ./...
```

Expected: PASS。

### Task 4: 刷新系统 prompt 快照并完成质量门

**Files:**
- Modify: `services/server/internal/service/prompt/testdata/document_no_scoped_edit.golden`
- Modify: `services/server/internal/service/prompt/testdata/no_project.golden`
- Modify: `services/server/internal/service/prompt/testdata/project_no_document.golden`
- Modify: `services/server/internal/service/prompt/testdata/scoped_edit_active.golden`

**Step 1: 刷新 golden snapshots**

Run:

```bash
cd services/server
UPDATE_PROMPT_GOLDENS=1 go test ./internal/service/prompt -run TestBuildACPPromptSnapshots -count=1
```

Expected: PASS，四个快照只反映 TOOLS 指令的图片异步终止语义。

**Step 2: 验证 prompt 和 MCP 集成**

Run:

```bash
cd services/server
go test -race ./internal/service/prompt ./internal/app/mcp
```

Expected: PASS。

**Step 3: 运行相关 Go 质量门**

Run:

```bash
cd packages/instructions && task check
cd packages/mcp && task check
cd services/server && task check
```

Expected: 全部退出码为 0。若全量 server lint/test 暴露与本次无关的既有问题，保留完整输出并单独说明；不得跳过本次涉及包的 race tests。
