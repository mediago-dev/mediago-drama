# Agent 视频提交即结束 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Agent 在视频任务被服务端接受并取得任务 ID 后立即结束当前 run，不再等待视频完成、重试、选片或回写。

**Architecture:** 将图片已有的“提交即结束”契约扩展到视频，同时保留音频/文本和后续显式任务处理能力。Agent 侧通过内置 Skill、官方 TOOLS 和 Generation MCP 三层契约收紧流程；现有异步视频链路保持不变，并让未来同步视频路由也由服务端后台执行。

**Tech Stack:** Go、MCP、Markdown prompt/Skill、Go testing、prompt golden snapshots。

---

## 已确认范围

- 单次和批次视频请求在获得已接受的 `taskId` 后立即结束当前 run。
- 同一 run 不 get/list/poll/retry/select，不展示结果选片，不等待尾帧，也不回写最终视频。
- 试片提交本身就是当前 run 的终点；用户后续确认后另起 run 提交剩余批次。
- 服务端继续负责后台提交/执行、状态同步、资产落库、项目资源首条结果自动选中和完成通知。
- 查询与处理工具继续注册，供音频/文本流程和用户后续明确操作既有任务使用。
- 不新增失败通知、Agent 自动续跑或 Markdown 后台回写。

### Task 1: 用测试锁定视频提交即结束契约

**Files:**
- Modify: `packages/instructions/pkg/pack/builtin/builtin_test.go`
- Modify: `packages/instructions/pkg/official/official_test.go`
- Modify: `packages/mcp/pkg/mcp/mcp_test.go`
- Modify: `services/server/internal/app/mcp/read_test.go`
- Modify: `services/server/internal/service/prompt/prompt_workspace_test.go`
- Modify: `services/server/internal/service/generation/generation_helpers_test.go`

**Step 1: 更新 Agent 指令契约测试**

要求视频 Skill、TOOLS、Generation MCP instructions 和 Generate/GenerateBatch 工具描述明确：

- 视频请求成功提交并取得任务 ID 后结束当前 run；
- 当前 run 不查询、轮询、重试、选片或回写；
- 后台服务继续处理并发送完成通知；
- 任务工具只用于音频/文本等适用流程或用户后续显式操作。

同时禁止视频 Skill 继续包含“同一回合内跟进”、等待阶段、交付阶段和批次完成后汇总/回写规则。

**Step 2: 运行测试确认新断言先失败**

Run:

```bash
cd packages/instructions && go test ./pkg/pack/builtin ./pkg/official -count=1
cd packages/mcp && go test ./pkg/mcp -count=1
cd services/server && go test ./internal/service/generation ./internal/app/mcp ./internal/service/prompt -count=1
```

Expected: FAIL，指出视频 Skill/MCP 仍允许同一 run 轮询和后处理，且同步视频没有进入服务端后台执行分支。

### Task 2: 改写视频 Skill 和官方 TOOLS

**Files:**
- Modify: `packages/instructions/pkg/pack/builtin/assets/skills/video-generation.skill.md`
- Modify: `packages/instructions/pkg/official/assets/instructions/TOOLS.md`
- Modify: `README.md`

**Step 1: 将视频 Skill 收敛为提交工作流**

- frontmatter 和核心边界只保留目标、参数、参考素材和提交职责。
- 把第 5 步改为“确认提交并结束”，删除第 6 步的当前 run 交付回写。
- 单次/批次返回任务 ID 后禁止 get/list/poll/retry/select、选片、尾帧等待和文档回写。
- 项目资源说明后台首条结果自动选中；人工改选留给后续显式操作。
- 试片与批量章节明确每次提交都是 run 终点，用户后续确认需重新获取当轮 `generation_plan`。

**Step 2: 统一 TOOLS 媒体分流**

- 图片或视频提交成功都立即结束当前 Agent run。
- 查询/处理工具只用于音频/文本等适用流程或用户后续明确操作。
- 图片/视频最终回复都只报告任务/批次 ID、初始状态和即时错误。

**Step 3: 同步 README**

增加 `video-generation` 能力行，描述参数与首帧确认、异步任务提交、后台落库和通知。

### Task 3: 固化 Generation MCP 与服务端硬边界

**Files:**
- Modify: `packages/mcp/pkg/mcp/tools.go`
- Modify: `services/server/internal/service/generation/generation_helpers.go`

**Step 1: 更新 MCP 硬边界**

把所有“当前图片提交回合”扩展为“当前图片或视频提交 run”，并把可使用任务工具的当前流程收窄为音频/文本等非视觉媒体流程。Generate/GenerateBatch 返回视频任务 ID 后也必须结束。

**Step 2: 后台化同步视频路由**

让 `ShouldRunGenerationInBackground` 对 `Async == false` 的图片或视频路由返回 true；异步视频仍走 `ShouldSubmitGenerationInBackground`，音频和文本保持原有分流。

### Task 4: 刷新快照并完成质量门

**Files:**
- Modify: `services/server/internal/service/prompt/testdata/document_no_scoped_edit.golden`
- Modify: `services/server/internal/service/prompt/testdata/no_project.golden`
- Modify: `services/server/internal/service/prompt/testdata/project_no_document.golden`
- Modify: `services/server/internal/service/prompt/testdata/scoped_edit_active.golden`

**Step 1: 刷新 prompt golden**

Run:

```bash
cd services/server
UPDATE_PROMPT_GOLDENS=1 go test ./internal/service/prompt -run TestBuildACPPromptSnapshots -count=1
```

Expected: PASS，快照只反映 TOOLS 中图片/视频统一的提交终止边界。

**Step 2: 运行相关回归**

Run:

```bash
cd packages/instructions && go test -race ./...
cd packages/mcp && go test -race ./...
cd services/server && go test -race ./internal/service/generation ./internal/service/prompt ./internal/app/mcp
```

Expected: PASS。

**Step 3: 运行工作区质量门**

Run:

```bash
cd packages/instructions && task check
cd packages/mcp && task check
cd services/server && task check
```

Expected: 全部退出码为 0；随后检查 git diff，确认没有误改无关文件或覆盖用户已有变更。
