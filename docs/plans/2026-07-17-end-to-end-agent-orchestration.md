# 端到端主 Agent 编排与子 Agent 协作 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让主 Agent 从用户目标出发自主规划和执行，简单任务自己处理、复杂任务自由使用原生子 Agent，在用户要求的产物边界停止，并通过持久化决定与现有生成参数弹窗完成可恢复的端到端闭环。

**Architecture:** 主 Agent 是唯一语义调度者；Runtime 只保存 Goal/Plan/Task/Invocation/Artifact/Event 投影、执行显式命令、保证幂等并转交用户决定与生成任务事实。子 Agent 继续走 Codex/ACP 原生协作，MediaGo 仅在真实 fixture 证明字段后做容错归一化。普通节点与媒体确认复用 AgentSelection；图片/视频的现有生成参数弹窗就是唯一确认。用户点击生成后先持久同一 command 的 preparation receipt 与输入 pin，再由 FinalizeWithPins 原子写 selection 决定和不可变 submission outbox；租约 worker 仅在 finalize 后用确定性本地任务 ID 和持久 provider key 提交。语义重试必须创建新 selection。

**Tech Stack:** Go、Gin、Gorm/SQLite、coder/acp-go-sdk、`@agentclientprotocol/codex-acp`、MCP Go SDK、React 19、TypeScript、SWR、Zustand、Vitest、Tailwind CSS v4。

---

## 实施前不可变约束

1. 不新增 Runtime scheduler、固定创作流水线、delegate API 或子 Agent 并发决策器。
2. 不由 Runtime 判断任务简单/复杂、语义重试、改计划或完成 Goal。
3. 不新增积分、成本、余额、付费提示或二次确认；现有生成参数弹窗就是确认。
4. 图片/视频每个新供应商任务 attempt 都要新 selection；同 commandId 的技术重放只返回原结果。
5. 不把附件中的 `spawnAgent`、`receiverThreadIds` 或 `_meta.codex.*` 当作事实；必须先通过当前 vendored adapter 的真实 fixture。
6. fixture 不足时降级为普通 ACP 工具事件，不伪造 AgentTask、AgentInvocation、父子关系、结果或 direct resume。
7. 当前 schema owner 是 Gorm `EnsureWorkspaceSchema`；只做 additive schema，不虚构 SQL migration 目录。
8. 逻辑 AgentTask 可等待用户并跨多次执行；单次 AgentInvocation 状态单调，进入终态后不能回退。
9. 保留现有未相关工作区修改；每个提交只显式 stage 本任务文件。
10. 自动决定队列与 Decide 必须绑定 `project + session + active workflow`，不能用 project 级查询串入其他聊天。
11. `generation_plan` 只有一个持久路由；Runtime-owned deferred selection 确认后只写 submission command，不同时发送通用 decision observation。
12. 在任何 provider 调用前必须持久 submission/item 与确定性 task/provider key；不支持幂等查询的 provider 出现模糊结果时只能 `unknown` 并 fail closed。
13. Continuation 采用稳定 delivery ID 与有期租约的 at-least-once 交付；不宣称 ACP 边界 exactly-once，后续 MCP commandId 必须幂等。
14. 子 Agent Invocation 失败只把逻辑 Task 标为可恢复 `needs_attention`，不自动标成 Task/Workflow failed。
15. `record_goal`、`record_plan`、`record_task_outcome`、`complete_goal`都是root专属语义写入；caller无法验证时全部先记proposal。即使caller可验证，replace、complete和root Task outcome也始终proposal化，与durable final答复同事务提交。
16. `record_goal(replace)` 是旧 Workflow 到确定性 successor 的 handoff；当前 Invocation 不热切换 scope。崩溃只恢复同一本地handoff/successor identity：pending/leased可dispatch，sending只能reconcile，证据不足保持unknown，绝不自动重复Prompt。
17. Selection 绑定 Artifact 自身版本和外部 ref 的权威版本/fingerprint；项目文档被直接编辑时，旧 pending selection 必须 supersede。
18. 现有“优化并生成”是同一确认下的 composite outbox；文本优化和媒体生成各有确定性 step/fence，未知优化结果不能自动重发。

## Task 0：建立真实 ACP 协作契约门禁

**Files:**

- Add: `services/server/cmd/acp-fixture-sanitize/main.go`
- Add: `services/server/cmd/acp-fixture-sanitize/main_test.go`
- Add: `services/server/internal/service/acp/testdata/codex-acp-1.1.2/README.md`
- Add: `services/server/internal/service/acp/testdata/codex-acp-1.1.2/contract.json`
- Add: `services/server/internal/service/acp/testdata/codex-acp-1.1.2/parallel-children.jsonl`
- Add: `services/server/internal/service/acp/testdata/codex-acp-1.1.2/failure-cancel.jsonl`
- Add: `services/server/internal/service/acp/testdata/codex-acp-1.1.2/root-child-whoami.jsonl`
- Add: `services/server/internal/service/acp/testdata/codex-acp-1.1.2/prompt-recovery.jsonl`
- Add: `services/server/internal/service/acp/acp_collaboration_fixture_test.go`
- Reference only: `packages/vendor/agents.json`
- Reference only: `services/server/internal/service/acp/acp_raw_log.go`

**Step 1: 写 fixture 缺失时失败的契约测试**

测试读取 contract 和四份 JSONL，要求真实事件覆盖：并行 child、wait、follow-up、resume 或 replacement、close、success、failure、cancel、parent 在 child 活跃时结束，root/child各调一次无副作用`workflow_whoami` probe，以及隔离的无副作用Prompt messageId echo/重复ID/lookup/result replay探测。Contract还必须明确initialize的`list/load/resume/close` capability、session/list是否含child、session/load是否回放内容，并回答MCP边界是否存在不可伪造的caller/thread identity；值只能为`supported | unsupported | not_observed`。另外强制记录`activeChildAfterParent=cancelled|continues|unobservable`、`lateChildUpdates`、`childReplay`、`finalizationSourceCorrelation`、`promptMessageIdEcho`、`promptLookupByMessageId`、`promptLookupDefinitelyAbsent`、`promptResultReplay`，以及`duplicatePromptMessageIdBehavior=deduplicates|reexecutes|unsupported|not_observed`。缺失时门禁失败，messageId echo不能冒充去重/lookup证据。

**Step 2: 运行测试确认失败**

```bash
cd services/server
go test ./internal/service/acp -run TestCodexACPCollaborationFixtureContract -count=1
```

Expected: FAIL，列出缺失场景，不能接受空或手写猜测 payload。

**Step 3: 实现只做脱敏和稳定 ID 映射的导入工具**

工具删除 token、authorization、绝对用户目录和完整创作 prompt；把 session/run/tool/thread ID 稳定映射为占位 ID；保留 JSON-RPC 方法、字段层级、状态、顺序、空值与 `_meta`。输出记录 `codex-acp=1.1.2`、`codex=0.144.0`，不得补字段或改动作名。

**Step 4: 用当前 vendored binary 运行固定场景并导入真实日志**

原始日志使用现有 `agent-sessions/<session>/acp-events.jsonl`。分别采集并行成功、失败/取消、root/child调用同一capture-only whoami probe，以及隔离的Prompt恢复探针四个场景。恢复探针显式设置同一messageId两次、尝试按ID lookup/结果replay，并记录第二次究竟去重还是重执行；若API不支持就如实记unsupported/not_observed，不能在创作Prompt上做此实验。每份原始日志分别脱敏到对应fixture：

```bash
cd services/server
go run ./cmd/acp-fixture-sanitize -source /absolute/path/to/acp-events.jsonl -out internal/service/acp/testdata/codex-acp-1.1.2/parallel-children.jsonl
```

如果本地没有可用 provider，停止并报告这个外部门禁；禁止手写“看起来合理”的 fixture。

**Step 5: 锁定观察结果和降级结论**

```bash
cd services/server
go test ./cmd/acp-fixture-sanitize ./internal/service/acp -run 'Test(FixtureSanitizer|CodexACPCollaborationFixtureContract)' -count=1
```

Expected: PASS。若关键关联字段不可观察，contract 必须声明 `projectionMode: ordinary_tool_only`。parent-active-child fixture 还必须证明 late update 是持续推送、可由 list/load 重放、被 adapter 取消，还是不可观察；专用 finalization prompt 必须单独采样来源 correlation，不能从普通 tool correlation 推断。

**Step 6: Commit**

```bash
git add services/server/cmd/acp-fixture-sanitize/main.go services/server/cmd/acp-fixture-sanitize/main_test.go services/server/internal/service/acp/testdata/codex-acp-1.1.2/README.md services/server/internal/service/acp/testdata/codex-acp-1.1.2/contract.json services/server/internal/service/acp/testdata/codex-acp-1.1.2/parallel-children.jsonl services/server/internal/service/acp/testdata/codex-acp-1.1.2/failure-cancel.jsonl services/server/internal/service/acp/testdata/codex-acp-1.1.2/root-child-whoami.jsonl services/server/internal/service/acp/testdata/codex-acp-1.1.2/prompt-recovery.jsonl services/server/internal/service/acp/acp_collaboration_fixture_test.go
git commit -m "test(agent): capture native ACP collaboration contract"
```

## Task 1：保留 ACP 扩展字段并实现只读协作归一化

**Depends on:** Task 0。若 `projectionMode=ordinary_tool_only`，只实现元数据保留和普通工具降级，跳过父子 Task/Invocation 推导。

**Files:**

- Add: `services/server/internal/service/acp/acp_collaboration.go`
- Add: `services/server/internal/service/acp/acp_collaboration_test.go`
- Modify: `services/server/internal/service/acp/acp_client_updates.go`
- Modify: `services/server/internal/service/acp/acp_client_router.go`
- Modify: `services/server/internal/service/acp/acp_events.go`
- Modify: `services/server/internal/service/acp/types.go`
- Modify: `services/server/internal/service/agent/agent_svc.go`
- Test: `services/server/internal/service/agent/agent_svc_test.go`
- Modify: `services/server/internal/service/agent/agent_event_semantics.go`
- Test: `services/server/internal/service/agent/agent_event_semantics_test.go`

**Step 1: 写失败的元数据保真测试**

从真实 fixture 构造 tool call/update 和 notification，断言内部事件保留标准字段、`rawInput/rawOutput`、tool `_meta` 与 notification `_meta`。当前实现应因丢弃 `_meta` 失败。

**Step 2: 写归一化与降级测试**

只对 contract 证明的字段断言 correlation key、native thread、parent、动作与终态。未知动作、缺关联键、乱序 update 都返回 `ok=false`，原普通工具事件仍存在。

按正交 contract 字段写组合测试：`cancelled` 投影真实 cancel；`continues + lateChildUpdates=supported` 在 resident进程保持 sink/drain至child terminal；`continues + childReplay=supported` 只走fixture证明的跨进程list/load/reconnect；continues但证据不足或`unobservable`在parent边界把已知active child变为interrupted/`needs_attention`，不能永久running。`ordinary_tool_only`下全部组合只保留普通ACP tool/activity，不创建child Task/Invocation。

**Step 3: 实现唯一 provider-specific normalizer**

最小内部输出：

```go
type AgentACPCollaboration struct {
    Action         string          `json:"action"`
    CorrelationKey string          `json:"correlationKey"`
    NativeThreadID string          `json:"nativeThreadId,omitempty"`
    ParentThreadID string          `json:"parentThreadId,omitempty"`
    Name           string          `json:"name,omitempty"`
    Task           string          `json:"task,omitempty"`
    Status         string          `json:"status"`
    Result         string          `json:"result,omitempty"`
    Raw            json.RawMessage `json:"raw,omitempty"`
}
```

此类型只描述事实，不提供执行 spawn/wait/send/resume/close 的方法。

normalizer 同时暴露由 contract 固化的正交 parent-boundary policy，但不自行发协作命令：resident live sink、跨进程 replay、真实 cancel和fail-closed interruption分别由证明字段控制。若 `projectionMode=ordinary_tool_only`，这些 policy不得生成富child投影。

**Step 4: 运行定向测试**

```bash
cd services/server
go test ./internal/service/acp ./internal/service/agent -run 'Test.*(Collaboration|Meta|Unknown)' -count=1
```

Expected: PASS；不符合 fixture 的事件仍显示为普通 ACP tool call。

**Step 5: Commit**

```bash
git add services/server/internal/service/acp/acp_collaboration.go services/server/internal/service/acp/acp_collaboration_test.go services/server/internal/service/acp/acp_client_updates.go services/server/internal/service/acp/acp_client_router.go services/server/internal/service/acp/acp_events.go services/server/internal/service/acp/types.go services/server/internal/service/agent/agent_svc.go services/server/internal/service/agent/agent_svc_test.go services/server/internal/service/agent/agent_event_semantics.go services/server/internal/service/agent/agent_event_semantics_test.go
git commit -m "feat(agent): normalize observed ACP collaboration events"
```

## Task 2：增加 Workflow 执行账本持久化

**Files:**

- Add: `services/server/internal/domain/agent_execution_models.go`
- Add: `services/server/internal/repository/agent_execution_repo.go`
- Add: `services/server/internal/repository/agent_execution_repo_test.go`
- Add: `services/server/internal/repository/agent_workflow_uow.go`
- Add: `services/server/internal/repository/agent_workflow_uow_test.go`
- Modify: `services/server/internal/domain/agent_models.go`
- Modify: `services/server/internal/domain/workspace_models.go`
- Modify: `services/server/internal/repository/agent_selection_repo.go`
- Modify: `services/server/internal/repository/agent_selection_repo_test.go`
- Modify: `services/server/internal/repository/agent_session_repo.go`
- Modify: `services/server/internal/repository/agent_session_repo_test.go`
- Modify: `services/server/internal/repository/db.go`
- Modify: `services/server/internal/repository/db_test.go`
- Modify: `services/server/internal/repository/provider.go`

**Step 1: 写 schema 和 repository 失败测试**

覆盖 `agent_workflows`、`agent_tasks`、`agent_invocations`、`agent_artifacts`、`agent_workflow_events`、`agent_root_proposals`、`agent_root_final_deliveries`、`agent_workflow_handoffs`、`agent_queued_inputs`；相同 event/command 重放只应用一次，payload 不同则冲突；ProjectionWriteSet 原子提交；Artifact `version` CAS；`ListRecoverable` 分开返回active workflow、未ack/未discard observation、可自动发布的`pending|journaled` root-final delivery、只作recovery issue的failed delivery，以及`pending|leased|sending|unknown` handoff。为AgentSession增加nullable`active_workflow_id/pending_final_delivery_id`及持久root-run lease owner/until/token；20个并发envelope创建只能CAS得到一个active Workflow。Continuation覆盖`pending → leased → delivered → acked`和任意未ack状态到`discarded`。RootFinalDelivery覆盖独立单调revision、正交publisher lease与`pending→journaled→published|failed`；唯一逆向边是project/session/delivery scoped reconcile在expected revision+fence及全量日志验证通过后执行`failed→pending|journaled`，相同command重放幂等、异payload冲突。Workflow handoff同样有独立revision，用predecessor+replace command唯一，覆盖`pending→leased→sending→started`、sending过期只进reconcile、`unknown|failed_definite|cancelled`，旧revision/fence转移失败。AgentSelection的workflow linkage/supersede字段在本底座先additive建好，使replace UoW不依赖后续Selection service。另从pre-migration fixture建legacy selection rows，锁定NULL/空`retention_mode`与`submission_owner`的物理回填和读取兼容。

**Step 2: 运行测试确认失败**

```bash
cd services/server
go test -race ./internal/repository -run 'TestAgentExecution|TestEnsureWorkspaceSchema.*Agent' -count=1
```

Expected: FAIL，缺类型/表/repository。

**Step 3: 定义 additive Gorm models**

`AgentWorkflowEventModel`增加`delivery_id/resume_token/delivery_status/lease_owner/lease_until/lease_token/attempt/last_error/next_attempt_at/delivered_at/acked_at/discarded_at/discard_reason`。`delivery_id`和`resume_token`使用nullable unique字段，普通事件写NULL，不能用带unique index的空字符串默认值。Artifact同时保存自身`version`与外部资源`ref_version`。Task增加`revision/current_invocation_id/last_invocation_status/last_error_code`；Invocation状态只允许单调前进。root Invocation保存nullable一次性`root_final_challenge_hash`（只在seal时写）、`status=pending|finalizing|committed|rejected|expired`、seal/snapshot hash、sealed/consumed时间。`AgentRootProposalModel`保存authenticated origin、proposer、action、不可变payload、expected revisions与`pending|committed|discarded`。

`AgentRootFinalDeliveryModel`按root Invocation唯一，保存稳定message/run-completed event IDs、ordered event bundle/fingerprint、`phase=pending|journaled|published|failed`、独立`revision/failure_code`、JSONL sequence范围、publisher lease/fence/retry与时间，不保存challenge/seal明文。AgentSession保存`pending_final_delivery_id`和持久root-run lease。`AgentWorkflowHandoffModel`保存predecessor final delivery、predecessor/successor/replace/proposal、原user message/handoff summary、确定性successor rootTask/invocation/run、target ACP session、dispatch message ID/fingerprint/recovery capability、`pending|leased|sending|started|unknown|failed_definite|cancelled`、独立`revision`与dispatch/reconcile lease/fence字段；revision供用户恢复动作CAS，不能复用lease token。`AgentQueuedInputModel`保存稳定user display event payload/fingerprint、final/handoff barrier、display phase、accepted/dispatch workflow及`pending|leased|dispatched|cancelled`；accepted workflow只审计，dispatch时必须重读session pointer/barrier。

同时只添加 AgentSelection 的 `session_id/workflow_id/requester_task_id/source_invocation_id/relay_task_id/decision_kind/artifact_id/artifact_version/artifact_ref_version/artifact_ref_fingerprint/resume_token/retention_mode/retry_of_selection_id/submission_owner/superseded_reason/superseded_by_version/superseded_at` 列与 tx-aware `SupersedePendingByWorkflow` primitive；具体创建/决策语义和 resolver 留给 Task 6。`EnsureWorkspaceSchema` 在同一可重放迁移中把旧 NULL/空 retention 回填为 `ephemeral`，旧 `generation_plan` 空 owner 回填为 `agent_mcp`，其他空 owner 回填为 `none`；新行使用非空默认，rolling-upgrade reader 对尚未回填的值执行同样规范化。migration fixture 必须证明 pending/decided legacy rows 重启后语义不变。

**Step 4: 实现无业务判断的 repository**

Repository 接受 service 已计算好的 ProjectionWriteSet，只负责事务、revision CAS、带 fence token 的有期租约、ack/discard、proposal 查询与 model round-trip。`agent_workflow_uow.go` 是创建/终止/replace 的唯一 DB transaction owner，可组合 execution/session/selection tx primitives；replace 以 `oldWorkflowId + commandId` 保证唯一 successor/rootTask/invocation/run/handoff，写入完整successor GoalContract v1，bulk-cancel旧scope Task，并在同一事务切换active pointer、建立final-delivery barrier、supersede selection与discard continuation。RootFinalDelivery/handoff repository只实现service已经授权的phase/revision/fence CAS和command-result幂等记录，不写文件、不调用ACP、不判断恢复能力；failed→pending|journaled若缺expected revision、有效fence或同command结果必须拒绝。禁止在 repository 中决定阶段、解锁步骤或下一任务。

**Step 5: 运行 repository 测试**

```bash
cd services/server
go test -race ./internal/repository -run 'TestAgentExecution|TestEnsureWorkspaceSchema.*Agent' -count=1
```

Expected: PASS。

**Step 6: Commit**

```bash
git add services/server/internal/domain/agent_execution_models.go services/server/internal/repository/agent_execution_repo.go services/server/internal/repository/agent_execution_repo_test.go services/server/internal/repository/agent_workflow_uow.go services/server/internal/repository/agent_workflow_uow_test.go services/server/internal/domain/agent_models.go services/server/internal/domain/workspace_models.go services/server/internal/repository/agent_selection_repo.go services/server/internal/repository/agent_selection_repo_test.go services/server/internal/repository/agent_session_repo.go services/server/internal/repository/agent_session_repo_test.go services/server/internal/repository/db.go services/server/internal/repository/db_test.go services/server/internal/repository/provider.go
git commit -m "feat(agent): persist passive workflow execution state"
```

## Task 3：实现被动 Workflow service 与投影器

**Depends on:** Task 2。

**Files:**

- Add: `services/server/internal/service/agent/agent_execution_store.go`
- Add: `services/server/internal/service/agent/agent_workflow_types.go`
- Add: `services/server/internal/service/agent/agent_workflow_service.go`
- Add: `services/server/internal/service/agent/agent_workflow_service_test.go`
- Add: `services/server/internal/service/agent/agent_root_authority.go`
- Add: `services/server/internal/service/agent/agent_root_authority_test.go`
- Add: `services/server/internal/service/agent/agent_execution_projector.go`
- Add: `services/server/internal/service/agent/agent_execution_projector_test.go`

**Step 1: 在消费方定义 store interface 和失败测试**

验证：Goal/Plan 版本只能严格连续增长：create expected 0→1，revise/plan expected N→N+1，禁止倒退和跳号；replace 校验旧 Goal expected N并创建 successor goal v1；重放返回首次 applied version。plan依赖只保存不自动解锁；`publish_artifact(expectedVersion)`以CAS自动产生下一Artifact version，不接受客户端自报的新版本；Invocation terminal不回退；Task可从running→waiting_user→running。child Invocation failed/cancelled/interrupted只有在`task.current_invocation_id`仍指向它时才把Task置为`needs_attention`，新Invocation可用expected Task revision在同一Task下恢复；A迟到失败不能覆盖已running的B。Task语义终态只接受root-authorized `record_task_outcome(expectedTaskRevision)`并把revision严格+1，terminal Task不能被新/迟到Invocation重开。`complete_goal`在root或任一child Task非终态时拒绝；同一ordered commit先终结全部Task后才能complete。replace/显式Workflow cancel则把旧scope所有非终态Task bulk-cancel并写稳定reason。重复commandId返回首次结果。

**Step 2: 运行失败测试**

```bash
cd services/server
go test ./internal/service/agent -run 'TestAgentWorkflow(Service|Projector)' -count=1
```

Expected: FAIL，缺 service/projector。

**Step 3: 实现只记录已声明事实的转换**

允许`publish_artifact`、`observed_task/invocation`，以及经RootAuthorityGate处理的`record_goal`、`record_plan`、`record_task_outcome`、`complete_goal`。`request_decision`的同Workflow child权限在这里定义为policy，但实际selection集成留给Task6。当caller identity未被fixture证明时，四种root专属动作只写不可变`AgentRootProposal`，不更新目标、计划、Task或Workflow；即使caller已验证，`record_goal(replace)`、`complete_goal`和目标为`root_task_id`的`record_task_outcome`也始终proposal化。只有verified create/revise、plan和child Task outcome可直接应用。proposal insert先锁authenticated origin root Invocation，只在challenge`pending`时允许；seal事务把pending CAS为`finalizing`，写seal token hash、sealed time与proposal snapshot hash后立刻释放DB锁。只有持token的runner能finalizing→committed/rejected；封存后调用返回`ROOT_INVOCATION_SEALED`且不留pending row，stale finalizing recovery必须rejected/discard/needs_attention。增加伪child四类写入不能改语义状态、verified terminal动作仍不提前应用，以及late child proposal vs seal、seal后崩溃重启、双runner seal只有一个成功且最终零pending proposal的测试。不要实现固定stage enum、依赖解锁、自动语义重试、自动完成或child dispatch。

AgentTask的`completed | failed | cancelled`只能来自root-authorized`record_task_outcome`；child Task outcome在caller可验证时可直接应用，root Task outcome始终由strict proposal commit应用。不得由plan文本、native child success或任意一次Invocation终态推导。新Invocation绑定和Task终态都使用expected revision CAS。`complete_goal`的strict commit precondition查询并锁定同Workflow全部Task，应用较早outcome proposals后非终态计数仍不为0则整个动作失败；replace/显式取消走审计明确的bulk cancellation primitive，不伪造child success。

`record_goal(replace)` commit 使用单一事务：旧 Workflow terminal、非终态 Task bulk-cancel 为 `workflow_replaced`、pending selection supersede、未 ack continuation discard、确定性 successor/rootTask/rootInvocation 创建、持久 pending `AgentWorkflowHandoff` 插入、session active pointer CAS。successor 直接保存 replace payload 的完整 GoalContract 为 version 1；handoff 保存由 authenticated run scope 注入的原 user message ID 和 proposal handoff summary。replace 重放返回同一 successor/handoff/goal v1，不能覆盖 successor goal；replace 与 complete 并发只允许一个获胜。

**Step 4: 实现事件投影幂等**

Projector 解析版本化 payload，计算 ProjectionWriteSet，再原子提交。未知 event version 保留原事件并返回可诊断错误，不能部分更新。

**Step 5: 运行 service 测试**

```bash
cd services/server
go test -race ./internal/service/agent -run 'TestAgentWorkflow(Service|Projector)' -count=1
```

Expected: PASS。

**Step 6: Commit**

```bash
git add services/server/internal/service/agent/agent_execution_store.go services/server/internal/service/agent/agent_workflow_types.go services/server/internal/service/agent/agent_workflow_service.go services/server/internal/service/agent/agent_workflow_service_test.go services/server/internal/service/agent/agent_root_authority.go services/server/internal/service/agent/agent_root_authority_test.go services/server/internal/service/agent/agent_execution_projector.go services/server/internal/service/agent/agent_execution_projector_test.go
git commit -m "feat(agent): project agent-authored workflow facts"
```

## Task 4：定义被动 Workflow MCP 工具

**Depends on:** Task 3。

**Files:**

- Add: `packages/mcp/pkg/mcp/workflow_types.go`
- Add: `packages/mcp/internal/tools/v2/workflow.go`
- Modify: `packages/mcp/pkg/mcp/tools.go`
- Modify: `packages/mcp/pkg/mcp/mcp_test.go`
- Modify: `packages/mcp/internal/tools/v2/register.go`
- Modify: `packages/mcp/pkg/server/store.go`
- Modify: `packages/mcp/pkg/server/server_test.go`

**Step 1: 写失败的公开工具契约测试**

用实现全部可选 capability 的 fake store 锁定 `record_goal`、`record_plan`、`record_task_outcome`、`publish_artifact`、`request_decision`、`complete_goal`。每个写工具要求 `commandId`，描述必须明确“记录/请求，不执行子 Agent 调度”。同时断言不存在 `delegate_agent`、`dispatch_task`、`set_parallelism` 或 `retry_node`。另用现有仅文档 store 断言不会广告任何尚未接线的 Workflow 工具，避免“工具已注册但调用必失败”。

**Step 2: 定义最小版本化协议**

- `RecordGoalInput`: `operation=create|revise|replace`、`expectedGoalVersion`与完整GoalContract；create只接受expected 0并写1，revise由服务端写expected+1；replace显式引用superseded workflow并携带successor GoalContract与handoff summary，校验旧expected后固定创建successor v1。原user message ID只能由authenticated run scope注入，不接受tool input自报。
- `RecordPlanInput`: `expectedPlanVersion`与稳定step ID；服务端只写expected+1，dependsOn只用于展示。
- `RecordTaskOutcomeInput`: taskId、`expectedTaskRevision`、`completed|failed|cancelled`、稳定 reason/error code。
- `PublishArtifactInput`: artifactId/expectedVersion、refType/refId/refVersion、kind/status/title/summary；服务端 CAS 后返回新 version。
- `RequestDecisionInput`: requesterTaskId、sourceInvocationId、decisionKind、artifactId/version、title/prompt/options；禁止 `generation_plan`。
- `CompleteGoalInput`: `completed | failed | cancelled`、`expectedGoalVersion` 和 Agent 说明；不接受 caller role/task/thread 等自报身份字段。

输出返回`workflowId/eventId/applied`及相应`appliedGoalVersion/appliedPlanVersion/appliedTaskRevision`；`request_decision`额外返回`selectionId + pending`。caller identity未验证时四种root专属工具统一返回`proposalId + proposalRecorded=true + applied=false`；caller已验证时，replace/complete/root Task outcome也使用同一proposal返回，只有create/revise、plan和child Task outcome可直接返回applied。proposal不可变保存expected与server-computed next version，不伪装已经改写Goal/Plan/Task/Workflow。replace工具始终返回确定性但尚未创建的`proposedSuccessorWorkflowId + applied=false + restartRequired=false`；strict root-final commit的持久结果才包含`successorWorkflowId + appliedGoalVersion=1`并触发handoff。`publish_artifact`、`request_decision`仍按WorkflowScope校验后直接生效。

**Step 3: 用窄可选 capability 注册工具，不扩展现有强类型 DocumentServices**

在 consumer package 定义窄 `WorkflowCoreStore`（五个 goal/plan/task/artifact/complete 方法）和 `WorkflowDecisionStore`（仅 `request_decision`）接口；`register.go` 只在传入 store 实现对应 capability 时注册该组工具。协议包测试可用 fake 实现两者，现有 app Adapter 在 Task 5/6 分别接线前仍可编译且不广告失败 stub。不要把六个方法直接塞进广泛使用的 `DocumentServices` 或 v2 Dispatcher 强制接口。`request_decision` 始终非阻塞；现有普通 `ask_user_selection` / `await_user_selection` 保持兼容，不把新工具实现成 blocking coordinator。

**Step 4: 运行 MCP 包测试**

```bash
cd packages/mcp
go test ./pkg/mcp ./internal/tools/v2 ./pkg/server -count=1
```

Expected: PASS；full-capability fake 的工具列表包含六个被动工具且不含调度工具，legacy/default store 列表不包含未接线能力，每个 commit 单独可编译。

**Step 5: Commit**

```bash
git add packages/mcp/pkg/mcp/workflow_types.go packages/mcp/internal/tools/v2/workflow.go packages/mcp/pkg/mcp/tools.go packages/mcp/pkg/mcp/mcp_test.go packages/mcp/internal/tools/v2/register.go packages/mcp/pkg/server/store.go packages/mcp/pkg/server/server_test.go
git commit -m "feat(mcp): expose passive agent workflow tools"
```

## Task 5：把 Workflow 上下文接入根 Invocation、MCP 与事件日志

**Depends on:** Tasks 0–4。Task 0/1 的 caller identity、finalization source correlation 与 ACP metadata/normalizer 是本任务的编译和安全前置，不能并行跳过。

**Files:**

- Add: `services/server/internal/app/mcp/workflow.go`
- Add: `services/server/internal/app/mcp/workflow_test.go`
- Add: `services/server/internal/service/acp/acp_root_final.go`
- Add: `services/server/internal/service/acp/acp_root_final_test.go`
- Add: `services/server/internal/service/acp/acp_root_final_capture_test.go`
- Add: `services/server/internal/service/agent/agent_root_final_delivery.go`
- Add: `services/server/internal/service/agent/agent_root_final_delivery_test.go`
- Add: `services/server/internal/service/agent/agent_root_final_publisher.go`
- Add: `services/server/internal/service/agent/agent_root_final_publisher_test.go`
- Add: `services/server/internal/service/agent/agent_root_final_recovery.go`
- Add: `services/server/internal/service/agent/agent_root_final_recovery_test.go`
- Modify: `packages/mcp/pkg/mcp/config.go`
- Modify: `packages/mcp/pkg/mcp/mcp_test.go`
- Modify: `packages/mcp/pkg/server/config.go`
- Modify: `packages/mcp/pkg/server/config_test.go`
- Modify: `services/server/internal/app/mcp/config.go`
- Modify: `services/server/internal/app/mcp/http.go`
- Modify: `services/server/internal/app/mcp/document_server.go`
- Modify: `services/server/internal/app/mcp/adapter.go`
- Modify: `services/server/internal/service/agent/agent_svc.go`
- Test: `services/server/internal/service/agent/agent_svc_test.go`
- Modify: `services/server/internal/service/agent/agent_runtime.go`
- Modify: `services/server/internal/service/agent/agent_sessions_service.go`
- Modify: `services/server/internal/service/chat/store.go`
- Add: `services/server/internal/service/chat/agent_root_final_delivery_test.go`
- Modify: `services/server/internal/app/events/broker.go`
- Modify: `services/server/internal/app/events/broker_test.go`
- Modify: `services/server/internal/service/acp/acp_runner.go`
- Modify: `services/server/internal/service/acp/acp_client_state.go`
- Modify: `services/server/internal/service/acp/acp_client_updates.go`
- Modify: `services/server/internal/service/acp/acp_raw_log.go`
- Modify: `services/server/internal/service/acp/acp_response.go`
- Modify: `services/server/internal/service/acp/acp_runner_run.go`
- Modify: `services/server/internal/service/acp/acp_runner_test.go`
- Modify: `services/server/internal/http/handlers/agent_sessions.go`
- Add: `services/server/internal/http/handlers/agent_sessions_test.go`
- Add: `services/server/internal/http/handlers/agent_root_final_deliveries.go`
- Add: `services/server/internal/http/handlers/agent_root_final_deliveries_test.go`
- Modify: `services/server/internal/http/routes/routes.go`
- Modify: `services/server/internal/http/handlers/swagger_annotations.go`
- Modify: `services/server/internal/app/development_docs_test.go`
- Modify: `services/server/internal/app/workspace/state.go`
- Modify: `services/server/internal/app/wire.go`
- Modify: `services/server/internal/app/api.go`
- Test: `services/server/internal/service/agent/agent_runtime_test.go`
- Test: `services/server/internal/app/mcp/http_integration_test.go`
- Test: `services/server/internal/service/agent/wire_contract_test.go`
- Modify: `apps/workspace/src/domains/agent/lib/streaming-events.ts`
- Add: `apps/workspace/src/domains/agent/lib/streaming-events.test.ts`
- Modify: `apps/workspace/src/domains/agent/lib/chat-sync.ts`
- Modify: `apps/workspace/src/domains/agent/lib/chat-sync.test.ts`
- Modify: `apps/workspace/src/api/types/agent.ts`
- Modify: `apps/workspace/src/domains/agent/stores/types.ts`
- Modify: `apps/workspace/src/domains/agent/stores/lifecycle-actions.ts`
- Modify: `apps/workspace/src/domains/agent/stores/store.ts`
- Modify: `apps/workspace/src/domains/agent/stores/store.test.ts`

**Step 1: 写 WorkflowID 全链路失败测试**

会话没有 active Workflow 时，Runtime 通过 session CAS 只分配一个空 `workflowId/rootTaskId` envelope，并把相同 ID 与新 invocationId 传入 accepted/started 事件、AgentRunRequest、document MCP config 与 Adapter。首个目标必须 `record_goal(create)`。会话已有 active Workflow 时，后续 root message 默认附着它；主 Agent通过 `record_goal(revise|replace)` 决定语义边界，Runtime 不猜测新消息是新 Goal。Continuation 复用 workflow/rootTask 并创建新 invocation；terminal Workflow 后才分配新的空 envelope。若 session 有未 `published` 的 RootFinalDelivery、pending/leased/sending/unknown handoff，或 active Workflow 是尚未 started 的 replace successor，新 user message 只能原子写 `AgentQueuedInput`、稳定 display-event payload/fingerprint 及对应 barrier ID并返回 accepted/queued；在 predecessor final published 前不得把这条用户消息写入权威 JSONL/SSE，也不得创建普通 Invocation。客户端可以乐观显示，但 hydrate 以最终 journal 为准。跨 project/session/task 的工具调用被拒绝；status/cancel 也必须使用 project + session，不能只按 session ID。

**Step 2: 扩展 transport config**

增加 `MEDIAGO_DRAMA_AGENT_WORKFLOW_ID`、`MEDIAGO_DRAMA_AGENT_TASK_ID`、`MEDIAGO_DRAMA_AGENT_INVOCATION_ID` 及 HTTP 映射，更新 protocol/app config 和 tests。

**Step 3: 实现 app MCP adapter**

`workflow.go` 从已认证 Runtime config 注入 `WorkflowScope{project,session,workflow}`，tool input 不能改写这些权限字段。它实现 Task 4 的 `WorkflowCoreStore`，只转换并接线 `record_goal`、`record_plan`、`record_task_outcome`、`publish_artifact`、`complete_goal` 五个工具；`request_decision` 的 `WorkflowDecisionStore` 在 Task 6 接入，避免本任务广告尚未实现的 durable selection service。增加真实 app registry 测试：此 commit 正好出现五个 Workflow 工具且调用可达，不存在失败 stub。

**Step 4: 在 Agent event 持久化成功后调用 projector 并锁定 root completion 边界**

`AppendAgentEvent` 获得 sequence 后投影；投影失败记录 structured error，交由 recovery 按 event ID 重放，不能默默丢状态。

把Task3的`RootAuthorityGate`接到真实caller evidence。若Task0证明caller identity，create/revise、plan和child Task outcome校验verified caller task等于`root_task_id`后可直接应用；replace、complete和root Task outcome仍只写proposal。若未证明，四种root专属工具都只写proposal。子Agent共享MCP endpoint时，即使伪造root task/thread字段也不能直接改Goal/Plan/Task/Workflow。

为顶层 root runner 新增独立的 `mediago.agent.final.v2` 严格 envelope，而不是给现有宽松 trailing JSON 增加一个可选字段。root Invocation 在正常执行期间的 challenge 为空；只有成功 seal proposal snapshot 的 runner 才生成一次明文 challenge、只持久其 hash，并把明文注入该 root 的专用 finalization prompt。ACP `MessageId` 可空且不稳定，只作诊断，不能作为 authority。

所有root Invocation的assistant用户消息delta先进入provisional buffer，工具/activity仍正常展示，最终答复不做token级streaming。“无proposal”分支必须在短事务中锁origin Invocation、重新计数pending proposals，并只在零条时原子执行`pending→expired`、写ordinary `AgentRootFinalDelivery` authoritative outbox、root completed投影及 `AgentSession.pending_final_delivery_id` barrier；delivery保存顺序固定的 `agent.message.completed → agent.run.completed` bundle、稳定message/event IDs、canonical fingerprint，初始phase为`pending`。SQLite事务内绝不写filesystem JSONL。若并发proposal先插入则转入finalization，若expire先赢则insert返回`ROOT_INVOCATION_SEALED`。若有任何proposal（包括verified terminal intent），runner先执行Task0 contract的child-boundary检查：只有`finalizationSourceCorrelation=supported`且fixture证明可无歧义分流时，才允许active child与finalization capture并存；否则已观察child必须terminal/显式close。边界仍active时不开始capture、不发布成功内容，rich projection写`needs_attention`，`ordinary_tool_only`只保留普通ACP事实并要求recovery continuation。通过边界后，runner在持有匹配root-run/session lease时用短事务生成challenge、把Invocation `pending→finalizing`，持久challenge/seal token hash、sealed time与pending proposal snapshot hash并释放DB锁；只有成功seal的runner才开启capture epoch、清空capture buffer再发专用finalization prompt。epoch内assistant文本不发`agent.message.delta`，任何工具调用或非预期update都使结果无效。同步prompt返回后关闭epoch并解析该buffer的全部文本。Raw ACP log必须把prompt/response中的明文challenge/seal token替换为hash/占位符。

输出必须是唯一 sentinel 后紧跟一个完整 JSON 对象并 EOF；对象包含 display content 与按应用顺序排列的 `rootCommit{proposalIds,workflowId,rootRunId,rootInvocationId,challenge}`。外层不重复Goal version；seal snapshot中每条proposal自己的expected/applied revision才是CAS依据。解析使用 `json.Decoder.DisallowUnknownFields`、确认没有第二个值或前后杂质，并校验 capture epoch、scope、run、invocation、proposal revisions、challenge 与 Workflow active 状态；不扫描完整 transcript、child/tool output 或普通消息。

正确challenge的首次commit在一个事务内锁定root Invocation/Workflow/proposals，要求challenge仍为`finalizing`、runner仍持匹配root-run/session lease、seal token hash与持久proposal snapshot hash匹配；只接受snapshot中且authenticated `origin_root_invocation_id`等于当前root的proposal，拒绝重复proposal ID，按列表顺序预检每条proposal自身的CAS。`replace`与`complete_goal`合计至多一个，若存在必须是proposalIds最后一项。若有`complete_goal`，预检还要求envelope中较早的outcomes应用后root与所有child Task全部terminal；否则整个commit冲突。全部通过才应用全部proposal、discard未选中的snapshot proposal、标记challenge committed，并在同一SQLite事务写strict `AgentRootFinalDelivery`有序bundle、root completed投影及session final barrier；该事务不写filesystem JSONL。replace/显式取消可按稳定reason bulk-cancel旧scope非终态Task。

RootFinalDelivery publisher以正交lease/fence领取`pending|journaled`行。`pending`阶段调用ChatStore唯一的per-session writer/file lock执行`repair-and-append-once`：flush并检查尾部；完整JSON缺换行则补换行，非法partial tail只截断到最后完整换行，非尾部损坏fail closed；按稳定event ID+canonical fingerprint去重，相同ID不同payload报冲突；不存在时分配连续sequence、逐条完整append、flush并`fsync`文件，首次创建还同步目录。修复或任何写失败后丢弃writer与sequence/read caches并重开扫描；完整bundle同步后CAS `pending→journaled`并记录sequence范围。`journaled`阶段通过`FanoutPersistedEvent`保留原sequence发布live事件且绝不再次append，随后CAS `published`并只清除匹配的session barrier。持久失败绝不fanout；冲突或非尾部损坏转`failed`并保持fail-closed needs-attention barrier。

wire SSE语义为at-least-once：fanout成功但published CAS前崩溃可再次发送相同event ID/sequence。持久AgentEvent新增server-computed `payloadFingerprint=SHA-256(domain-v1 + canonical JSON(immutable semantic event))`，canonical输入包含event ID与所有语义字段，明确排除尚未分配的`sequence`、`payloadFingerprint`自身以及fanout/transport临时字段；赋sequence前后fingerprint必须不变，改变任一语义字段必须冲突。该字段在JSONL、hydrate和SSE中原样保留，publisher/frontend只比较服务端值，不能由TypeScript重算或信任客户端自报。Broker的`FanoutPersistedEvent`不得清零sequence或再次append。前端把现有`applyEventSequence`升级为`applyEventIdentity{id,sequence,payloadFingerprint}`，用hydrate播种且有界保留最近identity：相同ID+sequence+fingerprint重放跳过；同ID/sequence但fingerprint不同、同ID映射不同sequence或同sequence映射不同ID都fail closed并触发session recovery/re-hydrate；新sequence gap仍按原逻辑补hydrate。legacy无fingerprint事件只保留现有sequence兼容，但所有新RootFinalDelivery bundle事件必须有fingerprint。故障承诺是JSONL append once和用户可见projection once，不是物理SSE frame once。

same-ID/different-payload或非尾部损坏把delivery置failed但不回退completed root Task；AgentSession status/chat snapshot派生nullable `rootFinalDeliveryRecovery{deliveryId,revision,errorCode,queuedInputCount,canReconcile}`。普通I/O失败仍留pending/backoff。新增`POST /api/v1/projects/:projectId/agent/sessions/:sessionId/root-final-deliveries/:deliveryId/reconcile`，请求带commandId/expectedRevision：它只在底层日志已由外部修复后重跑全量校验与允许的尾部repair，匹配原bundle时fence-CAS到journaled（已存在）或pending（需安全append），否则保持failed。它绝不能截断中间历史、改payload、清barrier或迁移queued inputs；相同command同payload重放返回原结果，不同payload/跨session/旧revision拒绝。

任一CAS冲突时不应用任何proposal，而在同一事务把challenge从`finalizing`标为rejected、discard snapshot proposals并写包含action摘要与当前Goal/Plan/Task revisions的durable recovery observation。非法/缺失envelope同样不发布provisional成功内容或completed；root收尾时discard snapshot proposals、把root Task标为`needs_attention`并写可重建observation。proposal insert、seal与zero-proposal expire共锁origin root Invocation并使用同一锁序；一旦状态不是pending，迟到child调用返回`ROOT_INVOCATION_SEALED`且不插row。进程在seal前崩溃时，recovery对任何不再active/interrupted且challenge为空的root Invocation原子置rejected：有proposal则discard全部origin proposals并写摘要，零proposal则记录`interrupted_before_final`且不创建final delivery；`expired`只用于正常zero-proposal final与ordinary delivery已经原子持久的路径。`finalizing`只有在匹配root-run/session lease已缺失或过期且超过stale timeout后才可rejected/discard；活lease下的slow capture不能被scan误杀，也不允许第二runner复用旧seal。新的continuation必须重新评估并用新commandIds提案，不依赖resident ACP或`list_proposals`。错误challenge本身不授权commit；root收尾仍使该challenge expired/rejected，已finalizing/committed/rejected/expired challenge都不能由其他runner重放。

现有`SplitACPResponseObject`/`parseACPFinalResponseForItem`可继续解析普通展示响应，但明确不能产出root authority。测试必须覆盖：所有root最终答复只由durable delivery显示且finalization JSON chunk从未出现在SSE/UI；root原样引用child completion JSON、代码块、嵌套JSON、合法对象前后多余文本、未知字段、工具调用、错误/重放challenge、错误run/invocation、过期Goal/Task revision均不得commit/显示completed；verified replace/complete/root Task outcome调用后语义状态仍未改变，只有strict commit后才terminal/switch；同一envelope中`revise N→N+1`后`complete(expected N+1)`按proposal顺序成功，外层没有歧义版本字段；root outcome缺失或waiting child尚未terminal时`complete_goal`全部拒绝；late child proposal与final seal并发后零pending proposal；proposal insert与zero-proposal expire竞态最终只能“proposal被seal”或“零proposal+expired”；proposal写入后seal前崩溃会discard/recover，尚无proposal就崩溃也会rejected并封死迟到insert；活跃root lease不会被stale scan误杀，lease过期并超过timeout才rejected；双runner只有一个能seal/commit；ordinary与strict delivery都覆盖DB commit→append前、JSON中途torn tail、完整JSON缺换行、换行→fsync数据保留/丢失、fsync→journaled CAS、journaled→fanout、fanout→published CAS、双publisher lease、同ID同/异payload与非尾部损坏，bundle sequence连续且JSONL只append一次；fanout→published崩溃允许wire SSE重复相同ID/sequence，但hydrate/stream/store可见投影恰好一次，不同payload冲突；identity测试还必须锁定同event ID映射不同sequence、同sequence映射不同event ID或同ID/sequence不同fingerprint都fail closed，hydrate播种cache后SSE重放仍去重，legacy无fingerprint只按sequence兼容，且新RootFinalDelivery bundle缺fingerprint直接拒绝；final处于pending/journaled时新root/continuation/handoff lifecycle事件数为0，replace最终顺序必须是`predecessor message.completed < predecessor run.completed < queued user events < successor accepted/started`；不支持source correlation时active child阻止capture，支持时迟到child update不污染final buffer；commit CAS失败只产生needs_attention/recovery observation；只有严格完整envelope成功后display content才可见。`record_goal(replace)`成功commit同时建立确定性successor goal v1/handoff并bulk-cancel旧scope Task，但当前Invocation仍属于旧Workflow并以handoff result结束，旧scope此后拒绝所有语义写入。

**Step 5: 运行定向测试**

```bash
cd services/server
go test ./internal/service/acp ./internal/service/agent ./internal/app/mcp ./internal/http/handlers ./internal/app -run 'Test.*(Workflow|RootFinal|RootFinalRecovery|RootAuthority|DocumentMCPConfig|Wire)' -count=1
cd ../../apps/workspace
pnpm exec vitest run src/domains/agent/lib/streaming-events.test.ts src/domains/agent/lib/chat-sync.test.ts src/domains/agent/stores/store.test.ts
```

Expected: PASS。

**Step 6: Commit**

```bash
git add packages/mcp/pkg/mcp/config.go packages/mcp/pkg/mcp/mcp_test.go packages/mcp/pkg/server/config.go packages/mcp/pkg/server/config_test.go services/server/internal/app/mcp/workflow.go services/server/internal/app/mcp/workflow_test.go services/server/internal/app/mcp/config.go services/server/internal/app/mcp/http.go services/server/internal/app/mcp/document_server.go services/server/internal/app/mcp/adapter.go services/server/internal/service/agent/agent_svc.go services/server/internal/service/agent/agent_svc_test.go services/server/internal/service/agent/agent_runtime.go services/server/internal/service/agent/agent_sessions_service.go services/server/internal/service/agent/agent_root_final_delivery.go services/server/internal/service/agent/agent_root_final_delivery_test.go services/server/internal/service/agent/agent_root_final_publisher.go services/server/internal/service/agent/agent_root_final_publisher_test.go services/server/internal/service/agent/agent_root_final_recovery.go services/server/internal/service/agent/agent_root_final_recovery_test.go services/server/internal/service/chat/store.go services/server/internal/service/chat/agent_root_final_delivery_test.go services/server/internal/app/events/broker.go services/server/internal/app/events/broker_test.go services/server/internal/service/acp/acp_root_final.go services/server/internal/service/acp/acp_root_final_test.go services/server/internal/service/acp/acp_root_final_capture_test.go services/server/internal/service/acp/acp_client_state.go services/server/internal/service/acp/acp_client_updates.go services/server/internal/service/acp/acp_raw_log.go services/server/internal/service/acp/acp_response.go services/server/internal/service/acp/acp_runner.go services/server/internal/service/acp/acp_runner_run.go services/server/internal/service/acp/acp_runner_test.go services/server/internal/http/handlers/agent_sessions.go services/server/internal/http/handlers/agent_sessions_test.go services/server/internal/http/handlers/agent_root_final_deliveries.go services/server/internal/http/handlers/agent_root_final_deliveries_test.go services/server/internal/http/handlers/swagger_annotations.go services/server/internal/http/routes/routes.go services/server/internal/app/development_docs_test.go services/server/internal/app/workspace/state.go services/server/internal/app/wire.go services/server/internal/app/api.go services/server/internal/service/agent/agent_runtime_test.go services/server/internal/app/mcp/http_integration_test.go services/server/internal/service/agent/wire_contract_test.go apps/workspace/src/api/types/agent.ts apps/workspace/src/domains/agent/lib/streaming-events.ts apps/workspace/src/domains/agent/lib/streaming-events.test.ts apps/workspace/src/domains/agent/lib/chat-sync.ts apps/workspace/src/domains/agent/lib/chat-sync.test.ts apps/workspace/src/domains/agent/stores/types.ts apps/workspace/src/domains/agent/stores/lifecycle-actions.ts apps/workspace/src/domains/agent/stores/store.ts apps/workspace/src/domains/agent/stores/store.test.ts
git commit -m "feat(agent): propagate workflow context through ACP runs"
```

## Task 6：让 Decision 可关联、非阻塞且跨根回合持久

**Depends on:** Tasks 2–5。

**Files:**

- Modify: `services/server/internal/domain/workspace_models.go`
- Modify: `services/server/internal/config/config.go`
- Modify: `services/server/internal/config/config_test.go`
- Modify: `services/server/configs/server.yaml`
- Modify: `services/server/internal/app/app.go`
- Modify: `services/server/cmd/mediago-server/main.go`
- Modify: `services/server/cmd/mediago-server/main_test.go`
- Modify: `services/server/internal/repository/db.go`
- Modify: `services/server/internal/repository/db_test.go`
- Modify: `services/server/internal/repository/agent_selection_repo.go`
- Modify: `services/server/internal/repository/agent_selection_repo_test.go`
- Modify: `services/server/internal/repository/agent_execution_repo.go`
- Modify: `services/server/internal/repository/agent_execution_repo_test.go`
- Modify: `services/server/internal/service/agent/agent_workflow_service.go`
- Modify: `services/server/internal/service/agent/agent_workflow_service_test.go`
- Modify: `services/server/internal/service/agent/agent_execution_projector.go`
- Modify: `services/server/internal/service/agent/agent_execution_projector_test.go`
- Modify: `services/server/internal/service/agent/agent_workflow_service.go`
- Modify: `services/server/internal/service/agent/agent_workflow_service_test.go`
- Modify: `services/server/internal/service/selection/types.go`
- Add: `services/server/internal/service/selection/artifact_ref_resolver.go`
- Add: `services/server/internal/service/selection/artifact_ref_resolver_test.go`
- Add: `services/server/internal/service/selection/input_snapshot.go`
- Add: `services/server/internal/service/selection/input_snapshot_test.go`
- Add: `services/server/internal/service/selection/workflow_outcome.go`
- Add: `services/server/internal/service/selection/workflow_outcome_test.go`
- Modify: `services/server/internal/service/selection/store.go`
- Modify: `services/server/internal/service/selection/store_test.go`
- Add: `services/server/internal/app/agent_artifact_ref_resolver.go`
- Add: `services/server/internal/app/agent_artifact_ref_resolver_test.go`
- Add: `services/server/internal/app/agent_selection_expiry_worker.go`
- Add: `services/server/internal/app/agent_selection_expiry_worker_test.go`
- Modify: `services/server/internal/service/document/store.go`
- Add: `services/server/internal/service/document/store_test.go`
- Modify: `services/server/internal/service/media/store.go`
- Modify: `services/server/internal/service/media/store_test.go`
- Modify: `services/server/internal/app/mcp/selection.go`
- Modify: `services/server/internal/app/mcp/selection_test.go`
- Modify: `packages/mcp/pkg/mcp/selection_types.go`
- Modify: `services/server/internal/app/wire.go`
- Modify: `services/server/internal/http/handlers/selections.go`
- Add: `services/server/internal/http/handlers/selections_test.go`
- Modify: `services/server/internal/http/routes/routes.go`

**Step 1: 写持久化关联失败测试**

为 AgentSelection 增加 `session_id/workflow_id/requester_task_id/source_invocation_id/relay_task_id/decision_kind/artifact_id/artifact_version/artifact_ref_version/artifact_ref_fingerprint/resume_token/retention_mode/retry_of_selection_id/submission_owner/superseded_reason/superseded_by_version/superseded_at`，并新增持久 `AgentSelectionInputSnapshot`（selection/ref scope、随机 token hash、authoritative version/fingerprint/content hash、expires/consumed/created）。`token_hash` 唯一，另建 selection+ref 与 expires 索引；允许同一 selection/ref 有多个未过期 token，刷新不使其他 tab失效。`EnsureWorkspaceSchema` additive迁移该表，migration/restart test锁定索引与round-trip。Requester/source必须属于同一 `WorkflowScope{project,session,workflow}`；`submission_owner=none|agent_mcp|runtime`创建后不可更改。新写入白名单仅允许`workflow+non-generation+none`、`workflow+generation_plan+runtime`、`ephemeral+generation_plan+agent_mcp`、`ephemeral+non-generation+none`，其他组合拒绝，legacy读兼容不反向放宽创建。创建时通过权威 resolver冻结Artifact与intent默认ref快照；不能只留live `referenceAssetIds`。最终提交还要校验用户在弹窗中实际保留/新增的全部ref token与当前快照，任一不匹配时不能写伪用户决定，而要进入统一superseded outcome UoW。

从 legacy DB fixture 验证 Task 2 的回填：NULL/空 retention 读写为 `ephemeral`，旧 generation_plan 空 owner 为 `agent_mcp`，其他空 owner 为 `none`，pending 与 decided rows 重启后保持。升级前 pending generation 若没有可信 intent/default snapshots，不能在点击时拿“当前素材”补快照；list/Decide 将其标为 `superseded(reconfirmation_required)`，provider 调用为 0，并要求 Agent 创建新 selection。只有权威 store 能按历史版本可靠恢复全部 fingerprints 时才允许迁移回填。

**Step 2: 写 workflow-durable 生命周期测试**

- `request_decision` 立即返回 pending。
- source Invocation 或根 Run terminal 时，workflow selection 不被 `ExpirePendingByRun` / `CancelPendingByRun` 清理。
- `Decide` 对 workflow mode 校验 workflow/task/artifact，而非要求 source Run 仍 active；新Invocation已绑定不使旧selection失效。
- ephemeral 旧 selection 继续使用现有 run guard。
- workflow mode 不使用现有 30m `RetrieveTTL`；新增 `workflowDecisionRetention` 配置，默认 7 天，创建时持久绝对 `expires_at`。从YAML `ServerConfig`经`cmd/mediago-server/main.go`显式映射到`internal/app.Config`并注入selection service，main wiring test锁定非零自定义值不会丢失。测试推进时钟超过30m并重启仍pending，达到deadline才expired；ephemeral仍按原TTL。
- Workflow terminal、Task terminal、显式取消、supersede 或独立 expiresAt 才终结 durable request。
- 创建selection、唯一`agent.workflow.decision.requested` event与requester Task事实投影必须在同一事务：创建时校验`requester_task.current_invocation_id == source_invocation_id`。后续Decide不要求stored source仍current；每个Task-linked结果统一通过`SelectionOutcomeUoW`原子写selection终态、可选稳定outcome delivery并重算Task。workflow普通内容的decided/cancelled/superseded/expired/failed进入`decision.*`；runtime generation在submission前进入`generation.confirmation.*`；generation成功submit只由Task12B写`generation.submitted`。ephemeral agent_mcp也调用UoW但不建continuation，commit后原waiter/重连await读取同一terminal result；测试覆盖result commit后、waiter return前崩溃不丢结果且不双wake。
- Task事实聚合器先实现为纯`ProjectTaskStatus(TaskWaitFacts)`加tx-scoped窄fact reader：terminal不动；active current且存在`pending selection.source_invocation_id=current`→waiting_user；否则active current→running；否则任一pending selection→waiting_user；否则`externalWaitCount>0`→waiting_external；否则无replacement的failed/cancelled/interrupted current事实→needs_attention；其余→waiting_agent。Task6不读取尚不存在的generation submission表，默认externalWaitCount=0；Task12B在12A建表后把同一transaction的nonterminal submission fact provider接入selection/submission所有UoW。测试覆盖A创建确认即waiting_user、同source两个pending只处理一个仍waiting_user、B已绑定后旧A决定仍成功且B保持running、B自己请求确认后waiting_user与崩溃重算；selection与submission并存测试留给Task12B。
- `publish_artifact(expectedVersion)` 事务内通过同一outcome UoW supersede 同 Artifact 旧版本 pending selections，记录 reason/newVersion并各写唯一delivery，不能静默移除等待。
- 用户绕过 Agent 直接编辑所引用的 WorkspaceDocument/媒体资产后，session-scoped pending list reconcile同样调用outcome UoW；即使尚未 list，Decide 也在同一事务前再次权威校验并 fail closed。deadline worker在到期时调用同一UoW写`decision.expired`或`generation.confirmation.expired`，重启后只重放稳定delivery，不留下永久waiting_user。
- generation 弹窗打开后、点击前任一 batch input ref 被 replace/delete 时，list/Decide 逐项 reconcile 并 supersede；任务与 provider 调用数均为 0，不能把相同 asset ID 的新 bytes 当作已确认内容。
- 现有弹窗新增/移除 refs 后，以最终 ordered IDs 为准；每个 ID 必须有同 selection/project、未过期的 opaque snapshot token，且 `referenceBindings[{id,ordinal,snapshotToken}]` 与 settings IDs 一一对应。缺 token、重复/乱序/跨 selection token都拒绝；刷新 token不泄露 raw fingerprint/hash。
- `record_task_outcome`终结单个Task时，同事务把该Task全部pending selections置`superseded`、reason=`task_terminal`，并discard关联Task所有未ack continuation delivery（含decision/confirmation/submitted）；不扩展selection status union。与Decide竞态只能一方先持久。已提交外部任务只归档/对账、不伪撤销，后续aggregate terminal不建delivery且不能重开terminal Task。
- Workflow terminal/replace 事务内清空 session active pointer，终结所有 pending workflow selections并discard未投递 continuation；已提交外部任务只归档不伪撤销。

**Step 3: 写 generation deferred/retry 测试**

- `AskUserFormInput.waitMode="deferred"` 创建 `retention_mode=workflow, submission_owner=runtime` 后立即返回 `pending`；空值仍 blocking，但只能创建 `retention_mode=ephemeral, submission_owner=agent_mcp`并沿用run guard/旧TTL。
- `retryOfSelectionId` 只能引用同 project/workflow/kind 的历史 generation selection。
- retry 禁止 recent-decision reuse，产生新 selectionId；相同 retry commandId 重放仍只产生一个新 ID。

**Step 4: 实现 consumer-owned ArtifactRefResolver**

在 selection 包定义 `ArtifactRefResolver.CurrentVersion(ctx, projectID, refType, refID) -> {version,fingerprint,contentHash}` 和 `WithStableVersion(ctx, ..., fn)`；app adapter 只调用现有 WorkspaceDocument/媒体资产权威 store，selection repository 不跨层查询其他表。创建和 pending list reconcile 对 Artifact 及 intent 默认 ref 使用 `CurrentVersion`；带 selection scope 的媒体列表/批量 snapshot endpoint 为当前展示资产签发随机 token，只返回 opaque token，repository保存 token hash与权威快照。Decide 与 generation UoW 必须验证最终 bindings、把全部规范化 ref key排序，并在所有 `WithStableVersion` mutation guards 内再次比较快照后提交事务，避免校验/提交 TOCTOU。document/media store提供最小只读 guard API，统一“规范化 ref key排序取 guard → selection DB transaction”的锁序。手工更新文档但不调用 `publish_artifact` 的测试必须使旧 selection自动 supersede；更新与决定并发时只能“更新先赢→selection superseded”或“决定先赢→冻结旧快照”，不能出现以旧快照决定却没有 guard 的第三种结果。无法读取/删除 ref时 fail closed，不把客户端提交的 `refVersion` 当权威值。

**Step 5: 启用 Task 2 的 additive 字段、session-scoped API 与单一事件路由**

新增 `/projects/:projectId/agent/sessions/:sessionId/selections`、`/:selectionId`、`/:selectionId/decision`，默认只对当前 active workflow 可见/可决策，可用精确 workflowId 作为额外校验。旧 project-scoped API 只保留给 ephemeral 兼容，新 UI 不使用。HTTP handler 仍只做 bind→application service→response。本任务同时让 app MCP selection adapter 实现 Task 4 的 `WorkflowDecisionStore`，至此才注册第六个 `request_decision` 工具；创建 `retention_mode=workflow` selection、发布唯一 `agent.workflow.decision.requested` 事件与requester Task的`waiting_user` CAS属于同一事务。registry 测试必须证明 Task 5 的五个 core 工具仍可用且第六个只有接线后才出现；故障注入还要证明selection commit与Task投影不会跨崩溃切点分裂。

单一outcome router必须同时看`retention_mode + decision_kind + submission_owner`白名单。workflow普通selection的所有非scope-terminal结果写唯一`decision.*` continuation；runtime generation在submission前的cancel/superseded/expired/failed写唯一`generation.confirmation.*`；Task-linked ephemeral legacy也原子持久结果/重算Task但不建continuation，live或重连waiter读取该结果。Task/Workflow terminal只清理并discard，不反向唤醒。`workflow_outcome`暴露带limit/cursor的`ExpireDue(now)`；`agent_selection_expiry_worker`由`app/wire.go`启动可停止的周期scan，使用有期lease/fence并在启动时立即补扫，不能只依赖ListPending懒清理。generation成功submit不发通用decision observation；Task12B负责在同一UoW创建outbox/submitted journal，并按owner只选择tool return或continuation之一。后续`generate_media(_batch)`只能查询已持久outcome，不能成为第二个提交时点。

**Step 6: 运行定向测试**

```bash
cd services/server
go test -race ./internal/repository ./internal/service/selection ./internal/service/agent ./internal/app/mcp ./internal/app ./internal/http/handlers -run 'Test.*(Selection|ArtifactRef|Deferred|Retry|Retention|Superseded|Expired|Outcome|TaskWait)' -count=1
```

Expected: PASS。

**Step 7: Commit**

```bash
git add services/server/internal/domain/workspace_models.go services/server/internal/config/config.go services/server/internal/config/config_test.go services/server/configs/server.yaml services/server/internal/app/app.go services/server/cmd/mediago-server/main.go services/server/cmd/mediago-server/main_test.go services/server/internal/repository/db.go services/server/internal/repository/db_test.go services/server/internal/repository/agent_selection_repo.go services/server/internal/repository/agent_selection_repo_test.go services/server/internal/repository/agent_execution_repo.go services/server/internal/repository/agent_execution_repo_test.go services/server/internal/service/agent/agent_workflow_service.go services/server/internal/service/agent/agent_workflow_service_test.go services/server/internal/service/agent/agent_execution_projector.go services/server/internal/service/agent/agent_execution_projector_test.go services/server/internal/service/selection/types.go services/server/internal/service/selection/artifact_ref_resolver.go services/server/internal/service/selection/artifact_ref_resolver_test.go services/server/internal/service/selection/input_snapshot.go services/server/internal/service/selection/input_snapshot_test.go services/server/internal/service/selection/workflow_outcome.go services/server/internal/service/selection/workflow_outcome_test.go services/server/internal/service/selection/store.go services/server/internal/service/selection/store_test.go services/server/internal/app/agent_artifact_ref_resolver.go services/server/internal/app/agent_artifact_ref_resolver_test.go services/server/internal/app/agent_selection_expiry_worker.go services/server/internal/app/agent_selection_expiry_worker_test.go services/server/internal/service/document/store.go services/server/internal/service/document/store_test.go services/server/internal/service/media/store.go services/server/internal/service/media/store_test.go services/server/internal/app/mcp/selection.go services/server/internal/app/mcp/selection_test.go packages/mcp/pkg/mcp/selection_types.go services/server/internal/app/wire.go services/server/internal/http/handlers/selections.go services/server/internal/http/handlers/selections_test.go services/server/internal/http/routes/routes.go
git commit -m "feat(agent): persist deferred workflow decisions"
```

## Task 7：实现 continuation inbox、主 Agent relay 与重启恢复

**Depends on:** Tasks 2、3、5、6。

**Files:**

- Add: `services/server/internal/service/agent/agent_continuation.go`
- Add: `services/server/internal/service/agent/agent_continuation_test.go`
- Add: `services/server/internal/service/agent/agent_recovery.go`
- Add: `services/server/internal/service/agent/agent_recovery_test.go`
- Add: `services/server/internal/service/agent/agent_handoff.go`
- Add: `services/server/internal/service/agent/agent_handoff_test.go`
- Add: `services/server/internal/service/agent/agent_handoff_recovery.go`
- Add: `services/server/internal/service/agent/agent_handoff_recovery_test.go`
- Add: `services/server/internal/service/prompt/continuation.go`
- Add: `services/server/internal/service/prompt/continuation_test.go`
- Add: `services/server/internal/app/agent_selection_bridge.go`
- Add: `services/server/internal/app/agent_selection_bridge_test.go`
- Add: `services/server/internal/app/agent_recovery_worker.go`
- Modify: `services/server/internal/service/agent/agent_runtime.go`
- Modify: `services/server/internal/service/agent/agent_runtime_test.go`
- Modify: `services/server/internal/service/agent/agent_sessions_service.go`
- Modify: `services/server/internal/service/agent/agent_session_persistence.go`
- Modify: `services/server/internal/service/acp/acp_runner_run.go`
- Add: `services/server/internal/http/handlers/agent_handoffs.go`
- Add: `services/server/internal/http/handlers/agent_handoffs_test.go`
- Modify: `services/server/internal/http/routes/routes.go`
- Modify: `services/server/internal/http/handlers/swagger_annotations.go`
- Modify: `services/server/internal/app/development_docs_test.go`
- Modify: `services/server/internal/app/api.go`
- Modify: `services/server/internal/app/wire.go`

**Step 1: 写 continuation 竞争测试**

- session idle 时同 `deliveryId/resumeToken` 同时只有一个有效租约和一个内部 continuation Invocation。
- active root Run 存在时 observation 留在 inbox，不抢占、不丢失。
- active Run 结束后单消费者 claim；多个已到达 observation 可批量交付。
- 两个决定并发时最多一个 drain goroutine，主 Agent收到两个 requesterTaskId。
- claim 后崩溃时从 `leased` 过期回到可交付，仍是同一 delivery ID；continuation accepted/start 只进入 `delivered` 并续租。只有 Invocation 成功到达可持久 terminal result 并回写 `agent.continuation.acked` 后才 `acked`；中途崩溃必须重投同一 ID。
- 每次 claim 生成递增 `leaseToken`；所有 `leased→delivered→acked` 转移都校验 owner + token。跨 ACP 边界前做最终事务 CAS：Workflow 仍 active、`session.active_workflow_id` 仍匹配、事件未 discarded、lease 仍归当前 worker。terminal/replace 赢得竞态时把未 ack 事件写成 `discarded`，已 lease 的旧 worker 不能再启动 root Run。
- continuation 失败保留 attempt/lastError/nextAttemptAt，属于传输重投，不自动重试语义动作。
- replace commit 后、successor Invocation 尚未启动时崩溃，recovery 从持久 `AgentWorkflowHandoff` claim 并只补启该确定性 successor Invocation；replace command replay 不创建第二个 successor/handoff。20 个并发 handoff worker 只有一个有效 fence lease；handoff 与此时到达的新用户消息竞态时，消息只进入 queued input，不能先创建另一个 successor Invocation。replace 与 complete 并发只有一个旧 Workflow CAS 能成功。
- handoff状态机覆盖`pending→leased→sending→started`、`sending→reconcile_only→started|pending|unknown`及`failed_definite|cancelled`。`leased`过期可以重新dispatch；`sending`落库后即认为可能跨越ACP边界，租约过期只能reconcile，绝不能直接重发。测试分别在claim后、sending前、sending commit后调用ACP前、ACP接受后started CAS前、首条update/messageId echo后CAS前、started CAS后runner内存绑定前崩溃；旧fence迟到更新都失败。
- 本地 successor Workflow/Task/Invocation/Handoff 具有exactly-once identity，但ACP Prompt只有fixture证明`messageId lookup + authoritative definitely-absent + duplicate suppression/result replay`时才可effectively-once恢复。lookup found→同一handoff `started`；权威definitely absent→同identity `pending`；unsupported/inconclusive→`unknown`并持续阻塞session。`failed_definite`只用于已证明未send的永久错误；传输timeout/断连不得伪装为failed。handoff/internal continuation模式禁用当前empty-response后新建ACP session并重发完整Prompt的逻辑。
- successor `workflowId/rootTaskId/invocationId/runId/dispatchMessageId`都在replace UoW预分配，`runId=successorInvocationId`（或同等固定映射），recovery不得调用随机生成run ID的普通用户提交入口。最终send CAS必须同时验证predecessor RootFinalDelivery=`published`、session final barrier已清、queued display events已按序journal、持久root-run lease可取得、session pointer及successor current invocation仍匹配。
- unknown recovery API严格绑定`project+session+handoff`：`GET /api/v1/projects/:projectId/agent/sessions/:sessionId/handoffs/recovery`只返回handoff ID/revision/status/recovery capability/queued count与可用动作；`POST .../handoffs/:handoffId/reconcile`与`POST .../handoffs/:handoffId/cancel`携带commandId与expected revision。跨project/session、非unknown、旧revision、相同command不同payload均拒绝；cancel重复返回原结果，reconcile每次用户新点击可用新commandId但网络重投幂等。测试验证未授权/跨session、20个并发动作和旧fence都不能越权。
- 按 Phase 0 contract覆盖parent-active-child：`continues + lateChildUpdates=supported`只保证同进程保留sink直到terminal；只有`childReplay=supported`才可用已证明list/load/reconnect跨重启补投影。continues但restart replay unsupported时，重启扫描把残留active Invocation标interrupted/`needs_attention`；`cancelled`保留真实cancel，`unobservable`在parent边界持久interrupted/`needs_attention`。`ordinary_tool_only`时不创建这些child投影，也绝不能留下伪running胶囊。

**Step 2: 写中性 observation prompt 测试**

Prompt 只包含版本、deliveryId、workflow/selection/artifact/requester IDs、用户决定或外部终态；不冒充新的用户气泡，不添加“下一步应该生成”等 Runtime 决策。指令要求对重复 delivery 复用稳定 MCP commandId。

**Step 3: 实现 `ResumeFromObservation`**

复用 MediaGo session、rootTask 和 persisted ACP session，分配新 invocation/run ID，标记 `internalContinuation=true`，通过持久root-run lease串行进入runner。dispatch前使用delivery lease fence做最终CAS，并要求session没有未published RootFinalDelivery、未解决handoff或尚待journal的queued display event；否则保留inbox lease/backoff。UI不渲染伪用户消息。

**Step 4: 替换 run persistence no-op 并实现 recovery**

持久化Invocation；启动时generic interruption scan只处理已有accepted/started/running执行证据、却无法证明仍运行的Invocation，并且只在它仍是`current_invocation_id`时用revision CAS触发Task事实重算。由`pending|leased|sending|unknown AgentWorkflowHandoff`引用的预建`pending` successor Invocation归handoff recovery独占，scan不得把它标interrupted；测试锁定先扫描再claim与先claim再扫描都只启动同一个successor。对不再active/interrupted且challenge尚为空的root Invocation事务封口：有proposal则rejected并discard全部origin proposals，零proposal则`rejected(interrupted_before_final)`且不造final delivery；`finalizing`只有在匹配root-run/session lease缺失或过期且超过stale timeout后才rejected/discard，活lease下的capture不得被误杀。各分支写recovery observation并绝不恢复旧seal token，迟到proposal insert均失败。先由publisher恢复`pending|journaled AgentRootFinalDelivery`，修复/fsync/fanout并清除匹配session barrier；再把barrier期间的queued user display events按accepted order journal+fanout；最后才允许handoff/continuation/root dispatch。随后重放JSONL未投影事件、恢复其他过期lease并claim-and-drain pending observation，永久忽略`discarded`。parent-active-child按正交contract恢复：resident drain只由lateChildUpdates控制，跨进程恢复只由childReplay控制，其余为真实cancel或fail-closed interruption，禁止从capability名称猜测。`ordinary_tool_only`只重放普通ACP事件。`agent_selection_bridge`只路由Task6持久的workflow `decision.*`和runtime `generation.confirmation.cancelled|superseded|expired|failed` delivery；忽略ephemeral waiter结果与已建立submission的generation decision，Task12B另只投递runtime owner的submitted和active scope的aggregate terminal，避免双唤醒。Task/Workflow terminal的相关delivery已在事务中discard。已跨边界的late Invocation只记录执行事实，terminal Workflow拒绝所有语义写入。

另实现 successor handoff recovery：仅`pending`或expired `leased`可由`lease_mode=dispatch`领取；最终短事务要求predecessor final已published、queued display journal已追平、旧root-run lease已释放，并以owner+递增token校验session pointer、handoff与预建successor Invocation尚未started、`successorRootTask.current_invocation_id == successorInvocationId`，同时取得绑定successor identity的持久root-run lease并把handoff置`sending`。事务提交后才用冻结的target ACP session、dispatch message ID、原user-message ref与handoff summary跨ACP；调用期间不持DB锁，不得换session/Prompt/instructions或identity。该路径不是Runtime规划，只完成root commit已经声明的作用域切换。

expired `sending`只能由`lease_mode=reconcile_only`领取：fixture-proven lookup found则CAS started并绑定同一runner/result；authoritative definitely-absent才允许退回pending；unsupported/inconclusive写`unknown`。`unknown`不清current invocation、不迁移原请求、不释放queued barrier、不接受任何自动新root。`ReconcileUnknownHandoff`只重复fixture lookup：found/definitely-absent按相同状态机收敛，仍不确定则保持unknown，绝不发送Prompt。`CancelUnknownHandoff`把unknown CAS为cancelled、bump fence、将successor root Task置needs_attention并清理current绑定、释放本地barrier；它不把原handoff Prompt恢复为队首，也不自动重发，迟到remote update只记审计。已有queued user inputs随后可按序dispatch，用户若要重做原请求必须给新指令。任何empty response、timeout、进程崩溃都不能触发第二次Prompt。`failed_definite`只接受ACP调用前可证明的永久错误；可重试pre-send错误保留pending/backoff；started后的runner中断走普通Invocation recovery，不能再用handoff发Prompt。

predecessor final published后，session append coordinator先在同一writer锁下按accepted order把barrier期间的queued user display events append-once/fsync/fanout，再允许successor accepted/started，确保`predecessor message.completed < predecessor run.completed < queued user events < successor accepted/started`。这些input仍保持`pending`语义状态；handoff root Run结束后再按accepted order fence-claim做语义dispatch。每条dispatch都重新读取`session.active_workflow_id`与所有barrier：遇到新的pending/sending/unknown handoff就原序重绑；指针为空/terminal就CAS分配新空envelope；否则绑定最新active Workflow。前一条触发二次replace/complete后，后续消息不能进入旧scope或丢失。Runtime不合并消息或判断revise/replace。

handoff `failed_definite`时，同一事务把successor Task置`needs_attention`，仅在current invocation仍匹配时清理预建绑定，并因已证明Prompt未send才可把原user message ref转成队首recovery input、解除/迁移其余barrier。unknown的显式cancel只放行已有queued inputs，不重排原Prompt。只要仍有pending queued input，新消息继续入队；统一dispatcher保持accepted order并在允许时重建root Invocation。测试覆盖failed_definite后无新消息/立即来新消息/服务重启均不丢原输入；unknown cancel后原Prompt不重发、后续inputs顺序不丢；unknown下无新消息、紧接新消息和重启都不会自动启动第二个Invocation。

**Step 5: 运行 race 测试**

```bash
cd services/server
go test -race ./internal/service/agent ./internal/service/prompt ./internal/service/acp ./internal/http/handlers ./internal/app -run 'Test.*(Continuation|Recovery|SelectionBridge|Observation|Successor|Handoff|RootFinal|QueuedOrder|ReplaceRace|Discard|ActiveChild)' -count=1
```

Expected: PASS。

**Step 6: Commit**

```bash
git add services/server/internal/service/agent/agent_continuation.go services/server/internal/service/agent/agent_continuation_test.go services/server/internal/service/agent/agent_recovery.go services/server/internal/service/agent/agent_recovery_test.go services/server/internal/service/agent/agent_handoff.go services/server/internal/service/agent/agent_handoff_test.go services/server/internal/service/agent/agent_handoff_recovery.go services/server/internal/service/agent/agent_handoff_recovery_test.go services/server/internal/service/prompt/continuation.go services/server/internal/service/prompt/continuation_test.go services/server/internal/app/agent_selection_bridge.go services/server/internal/app/agent_selection_bridge_test.go services/server/internal/app/agent_recovery_worker.go services/server/internal/service/agent/agent_runtime.go services/server/internal/service/agent/agent_runtime_test.go services/server/internal/service/agent/agent_sessions_service.go services/server/internal/service/agent/agent_session_persistence.go services/server/internal/service/acp/acp_runner_run.go services/server/internal/http/handlers/agent_handoffs.go services/server/internal/http/handlers/agent_handoffs_test.go services/server/internal/http/handlers/swagger_annotations.go services/server/internal/http/routes/routes.go services/server/internal/app/development_docs_test.go services/server/internal/app/api.go services/server/internal/app/wire.go
git commit -m "feat(agent): resume workflows from durable observations"
```

## Task 8：投影 AgentTask、AgentInvocation 和父子协作状态

**Depends on:** Tasks 0–5。`ordinary_tool_only` 时保留普通工具回归，跳过不可靠的 child projection。

**Files:**

- Modify: `services/server/internal/service/agent/agent_svc.go`
- Modify: `services/server/internal/service/agent/agent_event_projection.go`
- Modify: `services/server/internal/service/agent/agent_event_projection_acp.go`
- Modify: `services/server/internal/service/agent/agent_event_projection_conversation.go`
- Modify: `services/server/internal/service/agent/agent_event_projection_test.go`
- Modify: `services/server/internal/service/events/events.go`
- Modify: `services/server/internal/service/events/events_test.go`
- Modify: `services/server/internal/service/chat/store.go`
- Modify: `services/server/internal/service/chat/agent_event_log_test.go`
- Modify: `services/server/internal/app/agent_event_log_test.go`
- Modify: `services/server/internal/app/agent_streaming_test.go`

**Step 1: 写父子投影失败测试**

断言 ChatState 返回 `collaborationProjectionMode/rootTaskId/tasks/invocations/rootRunId/conversations`。rich 模式下一个 child Task 可关联多个 Invocation；第一 Invocation completed 后 Task waiting_user，第二 Invocation running 时第一条不回退。每次新 Invocation 绑定都用 expected Task revision CAS 并写 `current_invocation_id`。A 已被 B 替代后迟到的 failed/cancelled/interrupted 只更新 A 历史，B 和 Task 仍 running；只有当前 Invocation 失败才把 Task 投影为 `needs_attention` 并保留 last error。native Invocation completed 不自动 Task completed；Task 终态来自 root-authorized `record_task_outcome`，terminal Task 不能被新或迟到 Invocation 重开。并行 child 完成互不影响，不自动 Workflow terminal。`ordinary_tool_only` fixture 下 tasks/invocations 不含推导 child，原 ACP tool/activity 仍完整 replay。

**Step 2: 反转现有禁止 parent 字段的旧断言**

`agent_event_log_test.go` 当前要求清除 parentRunId；改为验证已校验的 `parentTaskId/parentInvocationId` 能持久化和 replay，未知 provider 字段仍只留在 raw ACP payload。

**Step 3: 修正 conversation children 与事件可靠性**

`AttachConversationChildren` 按 parent relationship 重建，不能清空全部 children。Task/Invocation terminal 事件加入 guaranteed event 集合；重复 replay 只更新同一投影。

**Step 4: 运行后端投影测试**

```bash
cd services/server
go test ./internal/service/agent ./internal/service/chat ./internal/service/events ./internal/app -run 'Test.*(Task|Invocation|Child|Parent|Conversation|Replay)' -count=1
```

Expected: PASS；rich fixture 产生父子投影，`ordinary_tool_only` fixture 只产生普通工具事实。

**Step 5: Commit**

```bash
git add services/server/internal/service/agent/agent_svc.go services/server/internal/service/agent/agent_event_projection.go services/server/internal/service/agent/agent_event_projection_acp.go services/server/internal/service/agent/agent_event_projection_conversation.go services/server/internal/service/agent/agent_event_projection_test.go services/server/internal/service/events/events.go services/server/internal/service/events/events_test.go services/server/internal/service/chat/store.go services/server/internal/service/chat/agent_event_log_test.go services/server/internal/app/agent_event_log_test.go services/server/internal/app/agent_streaming_test.go
git commit -m "feat(agent): project logical tasks and native invocations"
```

## Task 9：扩展前端 Agent store，避免 child 生命周期污染 root

**Depends on:** Task 8。

**Files:**

- Modify: `apps/workspace/src/api/types/agent.ts`
- Modify: `apps/workspace/src/domains/agent/api/agent.ts`
- Modify: `apps/workspace/src/domains/agent/api/agent.test.ts`
- Modify: `apps/workspace/src/domains/agent/stores/types.ts`
- Modify: `apps/workspace/src/domains/agent/stores/store.ts`
- Modify: `apps/workspace/src/domains/agent/stores/conversation.ts`
- Modify: `apps/workspace/src/domains/agent/stores/conversation.test.ts`
- Modify: `apps/workspace/src/domains/agent/stores/selectors.ts`
- Modify: `apps/workspace/src/domains/agent/stores/lifecycle-actions.ts`
- Modify: `apps/workspace/src/domains/agent/stores/store.test.ts`
- Modify: `apps/workspace/src/domains/agent/lib/chat-sync.ts`
- Modify: `apps/workspace/src/domains/agent/lib/chat-sync.test.ts`
- Modify: `apps/workspace/src/domains/agent/lib/streaming-events.ts`
- Modify: `apps/workspace/src/domains/agent/lib/streaming-events.test.ts`

**Step 1: 写 hydrate 与 streaming 失败测试**

- Snapshot hydrate 保留 tasks/invocations/conversations。
- 同一 taskId 的多个 invocation 聚合成一项逻辑 Task。
- child started 不调用 `bindRootRun`。
- child invocation completed 只结束目标 invocation，不调用 `finishNonTerminalConversations` 结束全部。
- root 是否 busy 只看当前 root Run，不因 child Task waiting/running 永久为 true。
- `AgentSelection` 类型与 API round-trip 保留 sessionId/workflowId/requesterTaskId/sourceInvocationId/artifactId/version/retentionMode/retryOfSelectionId/submissionOwner，不在前端重构丢字段。
- snapshot/stream 保留 `collaborationProjectionMode`；`ordinary_tool_only` 时 child selectors 返回空集合，普通 ACP tool items 不被过滤或包装成伪 Task。
- Chat snapshot/status与API类型保留nullable `handoffRecovery`（handoffId/revision/status/capability/queuedInputCount/canReconcile/canCancel）和`rootFinalDeliveryRecovery`（deliveryId/revision/errorCode/queuedInputCount/canReconcile），且只接受当前project/session响应。`getHandoffRecovery`、`reconcileHandoff`、`cancelHandoff`及`reconcileRootFinalDelivery` round-trip commandId/expectedRevision；跨session缓存key不能复用，recovery摘要都不含Prompt/final正文。

**Step 2: 增加独立 task/invocation slices**

不要把稳定 taskId 强塞进现有 runId-keyed transcript conversation。新增 `tasks` 与 `invocations` 投影，保留 conversations 负责消息流；selectors 负责关联。projection mode 是服务端 fixture-derived read-only capability，不由前端猜测或切换。handoff/root-final recovery都是session级异常事实，单独保存且在切换project/session或状态恢复时清空，不能伪装成child Task或回退completed root Task。

**Step 3: 增加 selectors**

至少提供 `selectAgentChildTasks`、`selectAgentTaskInvocations(taskId)`、`selectAgentIsRootRunning`、`selectAgentTaskPendingDecisionCount(taskId)`、`selectUnknownHandoffRecovery`、`selectRootFinalDeliveryRecovery`。

**Step 4: 运行前端 store 测试**

```bash
cd apps/workspace
pnpm exec vitest run src/domains/agent/stores src/domains/agent/lib/streaming-events.test.ts src/domains/agent/lib/chat-sync.test.ts
```

Expected: PASS。

**Step 5: Commit**

```bash
git add apps/workspace/src/api/types/agent.ts apps/workspace/src/domains/agent/api/agent.ts apps/workspace/src/domains/agent/api/agent.test.ts apps/workspace/src/domains/agent/stores/types.ts apps/workspace/src/domains/agent/stores/store.ts apps/workspace/src/domains/agent/stores/conversation.ts apps/workspace/src/domains/agent/stores/conversation.test.ts apps/workspace/src/domains/agent/stores/selectors.ts apps/workspace/src/domains/agent/stores/lifecycle-actions.ts apps/workspace/src/domains/agent/stores/store.test.ts apps/workspace/src/domains/agent/lib/chat-sync.ts apps/workspace/src/domains/agent/lib/chat-sync.test.ts apps/workspace/src/domains/agent/lib/streaming-events.ts apps/workspace/src/domains/agent/lib/streaming-events.test.ts
git commit -m "feat(agent-ui): track child tasks independently from root runs"
```

## Task 10：在聊天内渲染状态胶囊与可关闭详情 Sheet

**Depends on:** Tasks 7、9。

**Files:**

- Add: `apps/workspace/src/domains/agent/components/AgentSubagentStatusCapsule.tsx`
- Add: `apps/workspace/src/domains/agent/components/AgentSubagentStatusCapsule.test.tsx`
- Add: `apps/workspace/src/domains/agent/components/AgentSubagentDetailSheet.tsx`
- Add: `apps/workspace/src/domains/agent/components/AgentSubagentDetailSheet.test.tsx`
- Add: `apps/workspace/src/domains/agent/components/AgentHandoffRecoveryNotice.tsx`
- Add: `apps/workspace/src/domains/agent/components/AgentHandoffRecoveryNotice.test.tsx`
- Add: `apps/workspace/src/domains/agent/components/AgentRootFinalRecoveryNotice.tsx`
- Add: `apps/workspace/src/domains/agent/components/AgentRootFinalRecoveryNotice.test.tsx`
- Modify: `apps/workspace/src/domains/agent/components/AgentTimeline.tsx`
- Modify: `apps/workspace/src/domains/agent/components/AgentTimeline.test.tsx`
- Modify: `apps/workspace/src/domains/agent/components/AgentChat.tsx`
- Modify: `apps/workspace/src/domains/agent/components/AgentChat.test.tsx`
- Modify: `apps/workspace/src/domains/agent/components/chat/AgentLivePlan.tsx`
- Modify: `apps/workspace/src/domains/agent/components/chat/AgentLivePlan.test.tsx`
- Modify: `apps/workspace/src/domains/agent/components/timeline/PlanBlock.tsx`
- Reference: `apps/workspace/src/shared/components/ui/sheet.tsx`
- Reference: `apps/workspace/src/domains/documents/components/DocumentHistoryPanel.tsx`

**Step 1: 写胶囊原地更新测试**

rich 模式下同一 taskId 从 running→waiting_user→running→completed 始终只有一个胶囊；invocation 数量可在 Sheet 查看，但不产生多张胶囊。胶囊只显示名称、状态、当前步骤和待确认数。`ordinary_tool_only` 下不渲染胶囊或 Sheet 入口，聊天中的普通 ACP tool/activity 仍按原组件显示。

**Step 2: 写 Sheet 与 composer 测试**

点击胶囊打开右侧 Sheet；关闭销毁本地 selectedTaskId，不改变服务端 Task。Sheet 无 composer。child running/waiting 不禁用主 composer，只有 root Run 正在处理输入时禁用。

另用unknown handoff fixture断言现有任务区只出现一条`主流程切换 · 需要处理`，不是子Agent胶囊。lookup capability supported时有“重新检查”，unsupported时隐藏；“停止等待”始终可用。点击行复用可关闭Sheet显示status/queued count，不显示Prompt正文或新composer；两个动作直接调用scoped API，不再弹AlertDialog。mutation在一次网络重投期间复用同commandId/expectedRevision，成功后revalidate当前session；跨project/session结果不可操作。cancel后notice消失、原handoff不会自动成为新用户消息，已有queued inputs仍由后端按序处理。

RootFinalDelivery failed fixture只显示一条`消息记录发布 · 需要处理`，completed root Task保持terminal。Sheet只显示稳定error code/queued count和“重新检查”；该动作只调用全量revalidate API，失败后notice/barrier不变，修复成功后同一bundle继续发布。不可修复时只链接现有新建会话入口，明确不自动迁移旧queued inputs。无“跳过”“继续旧会话”或修改final正文的按钮。

**Step 3: 实现最小 UI**

复用现有Sheet和PlanBlock，不新增路由、常驻侧栏、Agent dashboard或第二套聊天。只有rich projection的真实child Task才有子Agent胶囊/Sheet；`ordinary_tool_only`不用空胶囊冒充能力。rich模式下ACP没有提供的局部详情显示“暂无可用活动详情”，不推测。unknown handoff与failed root-final notice是独立的session恢复事实，不受child projection mode影响；它们只有异常时出现。handoff `reconcile`永远只查不发，`cancel`表示停止本地等待而非重试；root-final `reconcile`只验证/恢复原bundle，不能绕过发布顺序。

**Step 4: 为后续决定入口保留无状态 callback**

Sheet 先接收可选 `onPendingDecisionsClick(taskId)` prop，并用 mock 验证点击待确认数量会回调；本任务不直接依赖尚未实现的 queue。Task 11 再把它连接到 picker。

**Step 5: 运行组件测试**

```bash
cd apps/workspace
pnpm exec vitest run src/domains/agent/components/AgentSubagentStatusCapsule.test.tsx src/domains/agent/components/AgentSubagentDetailSheet.test.tsx src/domains/agent/components/AgentHandoffRecoveryNotice.test.tsx src/domains/agent/components/AgentRootFinalRecoveryNotice.test.tsx src/domains/agent/components/AgentTimeline.test.tsx src/domains/agent/components/AgentChat.test.tsx src/domains/agent/components/chat/AgentLivePlan.test.tsx
```

Expected: PASS；两种 projection mode 都有测试，降级模式没有伪胶囊且普通工具展示不回退。

**Step 6: Commit**

```bash
git add apps/workspace/src/domains/agent/components/AgentSubagentStatusCapsule.tsx apps/workspace/src/domains/agent/components/AgentSubagentStatusCapsule.test.tsx apps/workspace/src/domains/agent/components/AgentSubagentDetailSheet.tsx apps/workspace/src/domains/agent/components/AgentSubagentDetailSheet.test.tsx apps/workspace/src/domains/agent/components/AgentHandoffRecoveryNotice.tsx apps/workspace/src/domains/agent/components/AgentHandoffRecoveryNotice.test.tsx apps/workspace/src/domains/agent/components/AgentRootFinalRecoveryNotice.tsx apps/workspace/src/domains/agent/components/AgentRootFinalRecoveryNotice.test.tsx apps/workspace/src/domains/agent/components/AgentTimeline.tsx apps/workspace/src/domains/agent/components/AgentTimeline.test.tsx apps/workspace/src/domains/agent/components/AgentChat.tsx apps/workspace/src/domains/agent/components/AgentChat.test.tsx apps/workspace/src/domains/agent/components/chat/AgentLivePlan.tsx apps/workspace/src/domains/agent/components/chat/AgentLivePlan.test.tsx apps/workspace/src/domains/agent/components/timeline/PlanBlock.tsx
git commit -m "feat(agent-ui): show child task capsules and details"
```

## Task 11：实现可选顺序的统一确认队列并复用现有生成弹窗

**Depends on:** Tasks 6、9、10。

**Files:**

- Add: `apps/workspace/src/domains/agent/hooks/useAgentDecisionQueue.ts`
- Add: `apps/workspace/src/domains/agent/hooks/useAgentDecisionQueue.test.ts`
- Add: `apps/workspace/src/domains/agent/components/AgentDecisionDialogHost.tsx`
- Add: `apps/workspace/src/domains/agent/components/AgentDecisionDialogHost.test.tsx`
- Add: `apps/workspace/src/domains/agent/components/AgentCheckpointDialog.tsx`
- Add: `apps/workspace/src/domains/agent/components/AgentPendingDecisionPicker.tsx`
- Modify: `apps/workspace/src/domains/agent/components/AgentSubagentDetailSheet.tsx`
- Modify: `apps/workspace/src/domains/agent/components/AgentSubagentDetailSheet.test.tsx`
- Modify: `apps/workspace/src/api/types/agent.ts`
- Modify: `apps/workspace/src/domains/agent/api/agent.ts`
- Modify: `apps/workspace/src/domains/agent/api/agent.test.ts`
- Modify: `apps/workspace/src/domains/agent/components/AgentChat.tsx`
- Modify: `apps/workspace/src/domains/agent/components/chat/AgentLivePlan.tsx`
- Modify: `apps/workspace/src/domains/agent/components/chat/AgentLivePlan.test.tsx`
- Modify: `apps/workspace/src/domains/agent/components/timeline/PlanBlock.tsx`
- Modify: `apps/workspace/src/domains/agent/components/timeline/AgentFormCard.tsx`
- Modify: `apps/workspace/src/domains/agent/components/timeline/AgentFormCard.test.tsx`
- Modify: `apps/workspace/src/domains/generation/components/BatchGenerationSettingsDialog.tsx`
- Modify: `apps/workspace/src/domains/generation/components/BatchGenerationSettingsDialog.render.test.tsx`
- Modify: `apps/workspace/src/domains/generation/hooks/useGenerationSettingsForm.ts`
- Modify: `apps/workspace/src/domains/generation/hooks/useGenerationSettingsForm.test.tsx`
- Modify: `apps/workspace/src/domains/workspace/api/media.ts`
- Add: `apps/workspace/src/domains/workspace/api/media.test.ts`
- Modify: `apps/workspace/src/domains/documents/components/GenerationModalShell.tsx`
- Test: `apps/workspace/src/domains/documents/components/GenerationModalShell.test.tsx`

**Step 1: 写 queue arbitration 失败测试**

- 使用包含 `projectId + sessionId + activeWorkflowId` 的 API/SWR key 查询 pending selections，按 ID 去重，默认 `createdAt/id` 排序。
- 同项目另一 session/Workflow 的 pending selection 既不在队列也不能通过 Decide 跨作用域提交。
- 同时只 active 一个。
- `activate(selectionId)` 可选择任意 pending，而不是强制 FIFO。
- confirm/reject 后默认推进下一项。
- dismiss 后当前项仍 pending，并暂停本轮自动推进。
- reload 后以服务端 selection 为准，不用 localStorage 伪造决定。

**Step 2: 拆分 dismiss/later 与 cancel/reject**

当前 GenerationModalShell/Batch dialog 把 X、Escape、outside click 和“取消”按钮都汇合到 `onOpenChange(false)`。新增兼容 props：

```ts
onDismiss(): void; // X / Escape / outside: later, no decision
onCancel(): void;  // existing Cancel button: persisted cancelled
```

现有非 Agent 调用保持原行为；Agent host 显式提供两个回调。

API 必须使用 Task 6 的 session-scoped routes；旧 project-scoped selection 列表不得作为新队列的 fallback。

**Step 3: 复用现有生成设置 presenter**

单项与批量都复用 `GenerationSettingsForm/useGenerationSettingsForm`。单项标题不显示“批量”，批量保留数量；现有参考素材增删继续可用。带 selection scope 的 media API 为已展示/选中的 asset 返回 opaque snapshot token；hook 在弹窗打开和选择变化时批量取得/刷新 token，任何 selected ID 缺 token或请求失败时禁用生成按钮并保留弹窗。确认回调把完整 `generation_settings` 与独立 `referenceBindings[{id,ordinal,snapshotToken}]` 提交给 `decideAgentSelection`，bindings 必须与 ordered `referenceAssetIds` 一一对应。前端不解析 token、不保存 raw version/fingerprint/hash。不要直接调用 ImageGenerationDialog/VideoGenerationDialog 的工作台提交逻辑。

**Step 4: 把聊天内媒体大表单改成轻量摘要**

AgentFormCard 对 generation intent 只显示“待确认/已确认/已取消”和打开弹窗入口；普通内容 checkpoint 由 AgentCheckpointDialog 呈现。现有任务区 pending count 打开紧凑 picker，Sheet 的 item 也能选择任一 selection。

**Step 5: 锁定无额外成本文案**

组件测试断言生成弹窗只出现现有参数、现有“生成/优化并生成”和“取消”；不得出现“积分”“成本”“付费”“余额”“供应商扣除”等新增文本，也不得出现第二个 AlertDialog。

**Step 6: 运行前端测试**

```bash
cd apps/workspace
pnpm exec vitest run src/domains/agent/hooks/useAgentDecisionQueue.test.ts src/domains/agent/components/AgentDecisionDialogHost.test.tsx src/domains/agent/components/AgentSubagentDetailSheet.test.tsx src/domains/agent/components/chat/AgentLivePlan.test.tsx src/domains/agent/components/timeline/AgentFormCard.test.tsx src/domains/generation/components/BatchGenerationSettingsDialog.render.test.tsx src/domains/generation/hooks/useGenerationSettingsForm.test.tsx src/domains/workspace/api/media.test.ts src/domains/documents/components/GenerationModalShell.test.tsx
```

Expected: PASS。

**Step 7: Commit**

```bash
git add apps/workspace/src/domains/agent/hooks/useAgentDecisionQueue.ts apps/workspace/src/domains/agent/hooks/useAgentDecisionQueue.test.ts apps/workspace/src/domains/agent/components/AgentDecisionDialogHost.tsx apps/workspace/src/domains/agent/components/AgentDecisionDialogHost.test.tsx apps/workspace/src/domains/agent/components/AgentCheckpointDialog.tsx apps/workspace/src/domains/agent/components/AgentPendingDecisionPicker.tsx apps/workspace/src/domains/agent/components/AgentSubagentDetailSheet.tsx apps/workspace/src/domains/agent/components/AgentSubagentDetailSheet.test.tsx apps/workspace/src/api/types/agent.ts apps/workspace/src/domains/agent/api/agent.ts apps/workspace/src/domains/agent/api/agent.test.ts apps/workspace/src/domains/agent/components/AgentChat.tsx apps/workspace/src/domains/agent/components/chat/AgentLivePlan.tsx apps/workspace/src/domains/agent/components/chat/AgentLivePlan.test.tsx apps/workspace/src/domains/agent/components/timeline/PlanBlock.tsx apps/workspace/src/domains/agent/components/timeline/AgentFormCard.tsx apps/workspace/src/domains/agent/components/timeline/AgentFormCard.test.tsx apps/workspace/src/domains/generation/components/BatchGenerationSettingsDialog.tsx apps/workspace/src/domains/generation/components/BatchGenerationSettingsDialog.render.test.tsx apps/workspace/src/domains/generation/hooks/useGenerationSettingsForm.ts apps/workspace/src/domains/generation/hooks/useGenerationSettingsForm.test.tsx apps/workspace/src/domains/workspace/api/media.ts apps/workspace/src/domains/workspace/api/media.test.ts apps/workspace/src/domains/documents/components/GenerationModalShell.tsx apps/workspace/src/domains/documents/components/GenerationModalShell.test.tsx
git commit -m "feat(agent-ui): queue decisions in existing dialogs"
```

## Task 12A：建立崩溃安全的媒体提交 outbox 与 provider 恢复边界

**Depends on:** Tasks 2 和 6。

**Files:**

- Add: `services/server/internal/domain/generation_submission_models.go`
- Add: `services/server/internal/repository/generation_submission_repo.go`
- Add: `services/server/internal/repository/generation_submission_repo_test.go`
- Add: `services/server/internal/repository/generation_preparation_repo.go`
- Add: `services/server/internal/repository/generation_preparation_repo_test.go`
- Add: `services/server/internal/repository/generation_input_pin_repo.go`
- Add: `services/server/internal/repository/generation_input_pin_repo_test.go`
- Add: `services/server/internal/service/generation/generation_submission_service.go`
- Add: `services/server/internal/service/generation/generation_submission_service_test.go`
- Add: `services/server/internal/service/generation/generation_input_pin_service.go`
- Add: `services/server/internal/service/generation/generation_input_pin_service_test.go`
- Add: `services/server/internal/service/generation/generation_preparation_service.go`
- Add: `services/server/internal/service/generation/generation_preparation_service_test.go`
- Modify: `services/server/internal/repository/db.go`
- Modify: `services/server/internal/repository/db_test.go`
- Modify: `services/server/internal/repository/provider.go`
- Modify: `services/server/internal/domain/generation_models.go`
- Modify: `services/server/internal/repository/generation_task_repo.go`
- Modify: `services/server/internal/repository/generation_task_repo_test.go`
- Modify: `services/server/internal/service/generation/generation_runtime.go`
- Modify: `services/server/internal/service/generation/generation_runtime_assets.go`
- Modify: `services/server/internal/service/generation/generation_runtime_provider.go`
- Modify: `services/server/internal/service/generation/generation_runtime_prompt_optimize.go`
- Modify: `services/server/internal/service/generation/generation_runtime_test.go`
- Modify: `services/server/internal/service/generation/generation_runtime_tasks.go`
- Modify: `services/server/internal/service/generation/generation_batch.go`
- Modify: `services/server/internal/service/generation/generation_batch_test.go`
- Modify: `services/server/internal/service/generation/generation_helpers.go`
- Modify: `services/server/internal/service/generation/generation_helpers_test.go`
- Modify: `services/server/internal/service/generation/generation_prompt_supplements_test.go`
- Modify: `services/server/internal/service/generation/generation_tasks_service.go`
- Modify: `services/server/internal/service/generation/generation_tasks_service_test.go`
- Modify: `services/server/internal/http/dto/generation.go`
- Modify: `services/server/internal/http/handlers/generation_tasks.go`
- Modify: `services/server/internal/http/handlers/generation_tasks_test.go`
- Modify: `services/server/internal/app/generation_worker.go`
- Modify: `services/server/internal/app/wire.go`
- Modify: `packages/core/pkg/generation/types.go`
- Modify: `packages/core/pkg/generation/runtime/provider.go`
- Modify: `packages/core/pkg/generation/runtime/provider_test.go`
- Modify: `packages/core/pkg/generation/openrouter/image.go`
- Modify: `packages/core/pkg/generation/openrouter/image_recovery_test.go`
- Modify: `apps/workspace/src/domains/generation/api/generation.ts`
- Modify: `apps/workspace/src/domains/generation/api/generation.test.ts`
- Modify: `apps/workspace/src/domains/generation/hooks/generationFormatters.ts`
- Modify: `apps/workspace/src/domains/generation/hooks/generationFormatters.test.ts`

**Step 1: 写持久 submission/item 与确定性 identity 失败测试**

新建 `generation_submissions`、`generation_submission_items` 和 `generation_submission_steps`。唯一约束分别是 `project_id + selection_id`、`submission_id + item_index`、`item_id + step_index`；submission 保存 `pending | dispatching | submitted | completed | failed | partial | cancelled | unknown` 总体状态/outcome，item 保存 `pending | running | completed | failed | cancelled | unknown`。普通生成每 item 一个 `generate_media` step；“优化并生成”每 item 有 `optimize_prompt → generate_media` 两个 step。Fingerprint 是同 selection 不可变的 conflict guard，可在不同 selection 重复，不建全局 unique index。使用分域 SHA-256 导出不含 prompt 的稳定 identity：

```text
submissionId = H("mediago-generation-submission-v1", projectId, selectionId)
preparationId = H("mediago-generation-preparation-v1", projectId, selectionId)
preparationCommandId = H("mediago-generation-preparation-command-v1", projectId, selectionId)
batchId      = H("mediago-generation-batch-v1", submissionId)
stepTaskId   = H("mediago-generation-step-task-v1", submissionId, itemIndex, intentItemId, stepKind)
providerKey  = H("mediago-generation-step-provider-v1", stepTaskId)
```

时间和 technical attempt 不进入 identity。单项也有一个 item；批次在 dispatch 前一次性保留所有有序 item/step/task ID。20 个并发 Ensure 只得到一个 submission 和同一组 IDs；fingerprint 冲突 fail closed。

同时新建`generation_preparations`作为submission前的durable receipt：保存`project_id/selection_id`、服务端派生的command ID、semantic command fingerprint、完整frozen authorized plan/settings/resolved reference bindings、确定性namespace/pin manifest、`preparing|pins_ready|finalized|failed`、lease owner/until/token及错误/时间。semantic fingerprint只含selection-bound operation/intent version、canonical settings与ordered ref ID/ordinal，明确排除raw snapshotToken、client request ID、时间等transport字段。resolved bindings只含snapshot row ID及authoritative version/fingerprint/content hash；raw token首次验证后丢弃，repository round-trip/error/log测试断言它不出现在DB JSON、outbox或日志。数据库以`project_id+selection_id`唯一；客户端不传/持久化command ID。相同semantic payload即使使用刷新/第二tab的不同有效token也返回原receipt，改变settings/ref ID/order则conflict并要求新selection。namespace和pin IDs由preparation identity分域派生，时间/worker/attempt不参与。状态只允许`preparing→pins_ready→finalized`或`preparing|pins_ready→failed`，所有转换用owner+单调fence CAS；expired lease只可领取同一receipt。

锁定 rollup：尚有非终态 item 时 submission 不 terminal；全 completed→completed；全 cancelled→cancelled；任一 unknown→unknown；有 completed 且混合 failed/cancelled→partial；无 completed 且任一 failed→failed；其余 cancelled。取消、unknown 和 batch mixed result 均用同一事务/CAS 持久。

`GenerationTaskModel` 增加唯一 `submission_key/origin_key` 与 submission/item 关联，Generation Service 接受由内部 submitter 传入的 deterministic task/batch ID。`CreateReservedTask` 对同 key + 同 fingerprint 幂等返回原 task，对不同 fingerprint 报 conflict，不再回退到随机 ID。

普通生成 step 直接持久 exact request；优化 step 持久 exact optimization request，后续 media step 先持久不可变 template，并在优化结果 CAS 落库时一次性物化 derived exact request。每个 step 还保存冻结的 `route_spec_json/route_spec_fingerprint/adapter_contract_version`，至少覆盖 kind、adapter、provider、model、参数 schema、limits；dispatch 不得重新解析当前 route catalog。

新建`generation_input_pins`与`generation_submission_input_pins`：pin带`owner_preparation_id`、nullable `owner_submission_id`、`pin_kind=source|provider_ready`、hash/size/blob key/transform spec version/status；join保存submission/item/step/purpose/ordinal、provider-ready pin、source audit pin、source version/fingerprint与`release_after`。首版不跨preparation/submission共享物理blob；两个相同hash的confirmation使用独立deterministic namespace/blob key。materializer只能读取receipt内的frozen plan，在其确定性ID写temp、校验hash/size，并按temp fsync→atomic rename→parent-directory fsync持久source/provider-ready bytes，再以fence CAS保存immutable manifest并置`pins_ready`。`preparing`恢复复用完整文件、只从相同plan补缺失/损坏pin；`pins_ready`恢复不重复materialize。

exact request只引用provider-ready pin，保留source pin用于审计；任何快照都不持久live asset path/URL、provider credential、Authorization header或临时签名URL。preparation状态是GC权威：`preparing|pins_ready`即使lease过期也禁止删除其namespace/pins；`failed`过retention后才可清理，真正没有receipt的temp才走grace cleanup。`finalized`后由submission retention接管，terminal只设置joins的release_after，全部过期后才CAS released并删除namespace。测试覆盖source/provider-ready hash、改变压缩默认值/transform实现版本后payload hash不变、两个相同hash preparation互不GC、终态retention、receipt-less temp cleanup、expired preparation lease与GC竞态、transform失败provider=0，以及temp fsync后、rename后parent-directory fsync前和dir fsync后`pins_ready`前的重启；在preparation finalized并有ready step前provider调用始终为0。

**Step 2: 写 fenced lease worker 和故障边界测试**

step 状态为 `blocked | ready | leased | sending | accepted | completed | failed_definite | cancelled | unknown`。Dispatch claim 在每次获得 `ready` 或 expired `leased` 时原子递增 `lease_token/technical_attempt_count` 并写 `lease_mode=dispatch`；所有转换按 owner + token CAS。置 `sending` 前必须解析 provider-ready pin并重验 hash/size；现有实现只允许把这些已转换 bytes 做 base64/data URI 等协议封装，不得再次压缩、转码或读取 live asset，也不需要新增临时 URL serving route。pin 缺失/损坏直接 `failed_definite` 且 provider 调用 0，绝不 fallback 到当前同 ID 资产。

dispatch 还要按冻结 adapter key/version 取得实现并校验 contract，直接使用 frozen route spec/model/params，绝不读取或比较当前 route catalog。catalog 中同routeId后来更换provider/model/schema不会使已确认请求失效；只要冻结adapter contract仍兼容，就继续按冻结计划提交。仅当冻结adapter实现缺失或contract version不兼容时才`failed_definite`、provider=0并要求重新确认，不能静默`ResolveRequestRoute/ApplyRoute`。外呼前持久 `sending/send_started_at/providerKey`。`leased` 过期后 W2 重领时，W1 的 CAS 失败且不得外呼；测试 Generate 总调用仍为 1，并覆盖 ready 后替换 route catalog 仍精确调用冻结route A，以及adapter contract不兼容时调用为0。

expired `sending` 不回到 dispatch 队列，而由 W2 以新的 fence token 和 `lease_mode=reconcile_only` 原子接管；它只能 route-level lookup 或标记 `unknown`，绝不能调用 Generate。两个恢复器并发只能一个 claim，原 W1 的迟到 accepted/failed response CAS 必须失败。注入故障点：outbox→task reservation、send marker→provider response、provider response→DB、optimization result→derived media exact request、batch 部分接受。租约过期后不得换 task/provider key。

**Step 3: 实现 provider 幂等/对账 capability 和 fail-closed unknown**

为内部 `generation.Request` 增加持久 `IdempotencyKey`，Runtime 原样传递。增加按每个 step 的 request route/adapter 判定的可选 `RecoverableSubmissionProvider`；只有 capability 显式提供结果 lookup 时，reconcile-only worker 才用同 key 查询。首版只允许已验证的 MediaGo `openrouter.images` 使用传入 key 和 `/images/results/{key}`。MediaGo `openrouter.chat.image`、普通 OpenRouter image、文本优化及其他 route 的测试必须返回 unsupported/fail closed，不能因同一 provider 对象而继承 capability。Dedupe-only 不授权第二次 Generate。Transport timeout、断连、5xx 或在 provider 受理后崩溃一律进入 `unknown`，自动 Generate 调用次数仍为 1。

删除现有“`submitting` 超过 2 分钟就盲目重提”逻辑。只有可证明从未 send 的任务才可 dispatch；legacy stale submitting 标为 unknown/需重新确认。

Outbox-only executor 不得调用会随机造 ID、Upsert 覆盖旧行或另起未受 outbox 状态机控制 goroutine 的旧异步路径。`CreateReservedTask` 必须 insert-only/同 key + fingerprint 返回旧 task，所有 task 状态单调 CAS；terminal 不能被 reservation replay 覆盖回 `submitting`。

**Step 4: 把现有“优化并生成”纳入同一 composite outbox**

替换 `CreatePromptOptimizedGenerationMessage` 先同步调用文本 provider、再调用旧 `CreateGenerationMessage` 的 Agent-confirmed 路径。UoW 先冻结 optimization exact request、media template、两个 deterministic task/provider key；optimization worker 成功后在一个 CAS 事务中保存 optimization task/`optimizedPrompt`，由冻结 template 物化 media exact request/fingerprint，并将 media step 从 blocked 置 ready。重启不得重新调用已发送但结果未知的文本优化；无 lookup 时进入 unknown，必须由 Agent 新建 selection 再经同一弹窗重试。普通非 Agent 工作台入口可暂时兼容旧同步行为，但 Agent-originated selection 只能走 composite outbox。

优化 failed/unknown 直接终结 item；优化 cancelled 把 item 与未启动 media step 标为 cancelled/skipped，media provider 调用为 0，参与一次 submission rollup。测试覆盖：优化 provider 调用前/后崩溃、优化输出已落库但 media step 尚未 ready、media send 前/后崩溃、优化 cancel 的单项/批量混合、批次部分优化成功；恢复始终复用同一 step IDs，已知 optimizedPrompt 不变化，未知优化不重发。

**Step 5: 禁止旧 image/video retry 绕过弹窗**

`RetryGenerationTask` 不再清空 providerTaskId 或改写旧 image/video task，HTTP 返回 `409 GENERATION_RECONFIRMATION_REQUIRED`，provider 调用为 0，旧 task/outcome 不变。前端 wrapper 不能把这个端点当成直接重试；未来的“重试”按钮必须重开现有设置弹窗。`unknown` 显示为“提交结果待确认”，不自动再发。

**Step 6: 运行底座定向测试**

```bash
cd services/server
go test -race ./internal/repository ./internal/service/generation ./internal/http/handlers ./internal/app -run 'Test.*(Preparation|Submission|Deterministic|Lease|Reconcile|Unknown|Optimize|Retry|StaleSubmitting|InputPin|FrozenRoute|Transform|GarbageCollect)' -count=1
cd ../../packages/core
go test -race ./pkg/generation/... -run 'Test.*(Idempotency|Recovery|Provider)' -count=1
cd ../../apps/workspace
pnpm exec vitest run src/domains/generation/api/generation.test.ts src/domains/generation/hooks/generationFormatters.test.ts
```

Expected: PASS。

**Step 7: Commit**

```bash
git add services/server/internal/domain/generation_submission_models.go services/server/internal/repository/generation_submission_repo.go services/server/internal/repository/generation_submission_repo_test.go services/server/internal/repository/generation_preparation_repo.go services/server/internal/repository/generation_preparation_repo_test.go services/server/internal/repository/generation_input_pin_repo.go services/server/internal/repository/generation_input_pin_repo_test.go services/server/internal/service/generation/generation_submission_service.go services/server/internal/service/generation/generation_submission_service_test.go services/server/internal/service/generation/generation_preparation_service.go services/server/internal/service/generation/generation_preparation_service_test.go services/server/internal/service/generation/generation_input_pin_service.go services/server/internal/service/generation/generation_input_pin_service_test.go services/server/internal/repository/db.go services/server/internal/repository/db_test.go services/server/internal/repository/provider.go services/server/internal/domain/generation_models.go services/server/internal/repository/generation_task_repo.go services/server/internal/repository/generation_task_repo_test.go services/server/internal/service/generation/generation_runtime.go services/server/internal/service/generation/generation_runtime_assets.go services/server/internal/service/generation/generation_runtime_provider.go services/server/internal/service/generation/generation_runtime_prompt_optimize.go services/server/internal/service/generation/generation_runtime_test.go services/server/internal/service/generation/generation_runtime_tasks.go services/server/internal/service/generation/generation_batch.go services/server/internal/service/generation/generation_batch_test.go services/server/internal/service/generation/generation_helpers.go services/server/internal/service/generation/generation_helpers_test.go services/server/internal/service/generation/generation_prompt_supplements_test.go services/server/internal/service/generation/generation_tasks_service.go services/server/internal/service/generation/generation_tasks_service_test.go services/server/internal/http/dto/generation.go services/server/internal/http/handlers/generation_tasks.go services/server/internal/http/handlers/generation_tasks_test.go services/server/internal/app/generation_worker.go services/server/internal/app/wire.go packages/core/pkg/generation/types.go packages/core/pkg/generation/runtime/provider.go packages/core/pkg/generation/runtime/provider_test.go packages/core/pkg/generation/openrouter/image.go packages/core/pkg/generation/openrouter/image_recovery_test.go apps/workspace/src/domains/generation/api/generation.ts apps/workspace/src/domains/generation/api/generation.test.ts apps/workspace/src/domains/generation/hooks/generationFormatters.ts apps/workspace/src/domains/generation/hooks/generationFormatters.test.ts
git commit -m "feat(generation): persist crash-safe submission commands"
```

## Task 12B：把 Agent 生成确认原子路由到 outbox 并恢复主 Agent

**Depends on:** Tasks 3、6、7、11 和 12A。

**Files:**

- Add: `services/server/internal/service/agentgeneration/submission.go`
- Add: `services/server/internal/service/agentgeneration/submission_test.go`
- Add: `services/server/internal/service/agentgeneration/decide_generation.go`
- Add: `services/server/internal/service/agentgeneration/decide_generation_test.go`
- Add: `services/server/internal/service/agentgeneration/request_builder.go`
- Add: `services/server/internal/service/agentgeneration/request_builder_test.go`
- Add: `services/server/internal/repository/agent_generation_tx.go`
- Add: `services/server/internal/repository/agent_generation_tx_test.go`
- Add: `services/server/internal/app/agent_generation_bridge.go`
- Add: `services/server/internal/app/agent_generation_bridge_test.go`
- Modify: `services/server/internal/domain/workspace_models.go`
- Modify: `services/server/internal/repository/agent_selection_repo.go`
- Modify: `services/server/internal/repository/agent_selection_repo_test.go`
- Modify: `services/server/internal/repository/agent_execution_repo.go`
- Modify: `services/server/internal/repository/agent_execution_repo_test.go`
- Modify: `services/server/internal/repository/generation_submission_repo.go`
- Modify: `services/server/internal/repository/generation_submission_repo_test.go`
- Modify: `services/server/internal/repository/generation_preparation_repo.go`
- Modify: `services/server/internal/repository/generation_preparation_repo_test.go`
- Modify: `services/server/internal/service/generation/generation_preparation_service.go`
- Modify: `services/server/internal/service/generation/generation_preparation_service_test.go`
- Modify: `services/server/internal/service/generation/generation_input_pin_service.go`
- Modify: `services/server/internal/service/generation/generation_input_pin_service_test.go`
- Modify: `services/server/internal/service/selection/store.go`
- Modify: `services/server/internal/service/selection/store_test.go`
- Modify: `services/server/internal/service/selection/workflow_outcome.go`
- Modify: `services/server/internal/service/selection/workflow_outcome_test.go`
- Modify: `services/server/internal/service/agent/agent_execution_projector.go`
- Modify: `services/server/internal/service/agent/agent_execution_projector_test.go`
- Modify: `services/server/internal/service/agent/agent_workflow_service.go`
- Modify: `services/server/internal/service/agent/agent_workflow_service_test.go`
- Modify: `services/server/internal/service/generation/generation_submission_service.go`
- Modify: `services/server/internal/service/generation/generation_submission_service_test.go`
- Modify: `services/server/internal/service/generation/generation_tasks_service.go`
- Modify: `services/server/internal/service/generation/generation_tasks_service_test.go`
- Modify: `services/server/internal/service/generation/generation_notifications_service.go`
- Modify: `services/server/internal/service/generation/generation_notifications_service_test.go`
- Modify: `services/server/internal/app/mcp/generation.go`
- Modify: `services/server/internal/app/mcp/generation_server.go`
- Modify: `services/server/internal/app/mcp/generation_test.go`
- Modify: `services/server/internal/app/mcp/generation_confirmation.go`
- Modify: `services/server/internal/app/mcp/generation_confirmation_test.go`
- Modify: `services/server/internal/app/agent_selection_bridge.go`
- Modify: `services/server/internal/app/agent_selection_bridge_test.go`
- Modify: `services/server/internal/app/agent_recovery_worker.go`
- Modify: `services/server/internal/app/wire.go`
- Modify: `apps/workspace/src/api/types/agent.ts`
- Modify: `apps/workspace/src/domains/agent/api/agent.ts`
- Modify: `apps/workspace/src/domains/agent/api/agent.test.ts`
- Modify: `apps/workspace/src/domains/agent/hooks/useAgentDecisionQueue.ts`
- Modify: `apps/workspace/src/domains/agent/hooks/useAgentDecisionQueue.test.ts`
- Modify: `apps/workspace/src/domains/agent/components/AgentPendingDecisionPicker.tsx`
- Modify: `apps/workspace/src/domains/agent/components/AgentDecisionDialogHost.test.tsx`
- Modify: `apps/workspace/src/domains/agent/components/timeline/AgentFormCard.tsx`
- Modify: `apps/workspace/src/domains/agent/components/timeline/AgentFormCard.test.tsx`

**Step 1: 写 server-authoritative request builder 和 owner 路由测试**

从 persisted immutable intent + submitted `generation_settings` 构造单项/有序批次；item 数量、prompt、目标和顺序来自 intent，route/params/优化/补充以及现有弹窗允许用户增删后的最终有序 `referenceAssetIds` 来自最终设置，intent refs 只是默认值/约束。UI 对每个最终 ref 同时提交其展示时由服务端资产列表返回的 opaque authoritative snapshot token；builder 按 project/route/数量限制验证 token 与 ID/ordinal，服务端 resolver 再比较当前 version/fingerprint/hash。缺字段、跨 WorkflowScope、Artifact version 或任一最终 ref 过期/删除/mismatch 都 fail closed，provider=0；不能忽略用户新增引用，也不能用同 ID 的新 bytes 替换其看到的旧版本。

Builder明确分成三个有持久边界的阶段。它先从selection-bound operation/intent version、canonical settings与ordered ref ID/ordinal计算transport-token-free `semanticCommandFingerprint`，不把snapshotToken/client request ID/UI timestamp纳入。`ResolveAuthorizedPlan`在全部ref mutation guards内首次验证raw tokens、规范化最终settings/ordered refs，解析并冻结resolved authoritative bindings、route spec、adapter contract、versioned transform spec与全部step identity，产生稳定`authorizedPlanFingerprint`；raw tokens随后丢弃。紧接着`BeginPreparation`短事务写入同一command的frozen plan/settings/resolved bindings及确定性namespace/pin IDs，事务成功后才允许materializer写blob。materializer只按receipt生成source audit pin与provider-ready pin并CAS `pins_ready`。随后`FinalizeWithPins`事务只校验selection/Artifact/ref CAS、receipt/fence、plan fingerprint与pin manifest，绑定pins并持久普通media exact request，或“优化并生成”的optimization exact request + media template，同时把receipt置`finalized`；它不得再次读取catalog、解析route或改变transform spec。exact snapshot只含provider-ready pin identity/hash/用途/顺序和source audit join，不含live refs/raw token。优化结果只能通过CAS从冻结template物化一次derived media exact request；worker不从可变intent/settings/current assets/current route catalog重建。两种`submission_owner`都在点击时进入同一编排；Runtime bridge只拥有deferred的返回/continuation通道，legacy blocking MCP只拥有原等待tool call，不能互相resolve。

**Step 2: 在 service/agentgeneration 实现 `DecideGenerationWithSubmission` 业务 UoW**

业务编排只放在 `service/agentgeneration/decide_generation.go`：它可以调用 selection resolver、generation pin service 和 server-authoritative builder。`repository/agent_generation_tx.go` 只提供 `WithTx`、tx-scoped stores、CAS/insert primitives，不 import 任何 service，也不做 ref 解析、pin 转换、route/build/owner/Artifact 业务判断，避免 service↔repository import cycle；禁止嵌套事务或 commit 后 observer 补写。

入口首先lookup-first：在读取live refs、取得guards、解析route或验证token前，按project+selection查询既有submission；stored semantic command fingerprint相同就直接返回原submission/pins/provider keys/outcome，不同则conflict。若没有submission，再以同一key查preparation：相同semantic fingerprint领取/等待同一receipt，不同则conflict并要求新selection；已有receipt lookup不重新校验后来刷新/过期的token。preparation/command ID由server从project+selection派生，HTTP DTO不新增客户端commandId。只有两者都不存在时，service才在Task6 resolver的全部最终input ref规范化mutation guards内逐项验证opaque snapshot token，调用`ResolveAuthorizedPlan`冻结plan A，并在写任何blob前调用`BeginPreparation(plan A)`。materializer以receipt fence在deterministic namespace生成/复用source + provider-ready blobs并置`pins_ready`。随后开启repository transaction并再次lookup，调用`FinalizeWithPins(receipt, pins)`；首次finalize事务同时校验`project/session/workflow`、selection pending与owner，CAS校验Artifact/ref version/fingerprint/hash、authorized plan fingerprint与pin manifest，绑定双pin rows/joins，持久用户最终settings/decision、唯一submission、全部有序items/steps/task IDs/provider keys、generating Artifact/final media task绑定，按journal sequence追加唯一`generation.submitted` journal event，用同tx generation fact provider重算requester Task，并把preparation `pins_ready→finalized`。该事务不得重新运行route resolver或读取当前catalog。

prepare/pin期间允许存在技术receipt和deterministic blob，但不得存在部分业务submission、selection decision、submitted event、ready step或provider调用。validation/materialization失败通过同一SelectionOutcomeUoW把receipt置failed并终结selection；finalize事务要么完整成功，要么业务状态零写入。相同command并发20次只得到一个preparation、一次deterministic pin manifest和一个submission；旧fence迟到写失败。同selection指纹冲突拒绝，不同selection允许相同fingerprint。

`BeginPreparation`同一事务把receipt ID关联到selection，并让pending-list DTO返回`generationProcessingPhase=preparing|pins_ready`与稳定preparation ID。此时selection仍是审计上的pending，但不再actionable：自动队列、picker、普通Decide和第二tab都排除它，只在原任务区轻量显示“正在准备生成”，不新增弹窗。Task6事实聚合器的pending selection count只统计actionable selection，并由Task12B generation fact provider同时加入active preparation count：blocking owner仍有active current Invocation时回running；deferred且无active current时进入waiting_external。worker pause、刷新或重启都不回waiting_user。

所有pre-submission`SelectionOutcomeUoW`及`record_task_outcome`、Workflow cancel/replace使用固定selection→preparation→Task/Workflow锁序：若receipt仍`preparing|pins_ready`，同事务写`failed(scope_terminal|selection_terminal)`、递增fence、清lease并终结selection/重算Task；旧materializer/finalizer后续CAS失败。若Finalize先赢，则只归档已建submission；若Outcome先赢，Finalize只读取已有终态且不得再建第二条outcome。覆盖explicit cancel、deadline expiry、Artifact/ref supersede、validation failure、Task terminal和Workflow replace与preparing/pins_ready/finalize三方竞态，结果只能是一个finalized submission或一个failed receipt+唯一pre-submission outcome，provider调用为0。

测试在弹窗打开/选中ref后、点击前replace/delete任一最终asset会supersede pending selection且provider=0；finalize前发布新Artifact/refVersion也会supersede并把preparation稳定终结。还要在`ResolveAuthorizedPlan`、preparation commit、任一pin的temp fsync/atomic rename/parent-dir fsync、`pins_ready`和`FinalizeWithPins`之间修改当前catalog或注入崩溃：恢复始终复用plan A、同preparation/namespace/pin IDs，dispatch在adapter contract兼容时按A调用且不要求重确认，绝不出现按route A转换pin却按route B提交的split-brain。expired preparation lease与GC并发时GC必须保留`preparing|pins_ready`资源；直到finalized outbox step被claim前provider调用为0。finalize commit后再发布新版本，不会改写、撤销或让已授权submission自我失效，因为outbox已冻结原Artifact/refVersion、route spec和provider-ready pins。确认后、dispatch前替换/删除原资产或修改compression defaults，provider payload hash仍等于确认快照；pin blob被破坏或冻结adapter contract不可用/不兼容则provider调用为0并稳定fail definite，绝不fallback current/catalog。

测试还覆盖response在preparation commit前丢失、preparation commit后丢失、pins_ready后丢失，以及finalize commit后丢失，并在reload/new tab用相同semantic payload重放：server-derived IDs不变，先返回/恢复原preparation或submission，不重新解析route、读取已变化的live ref或分配pin；同ref/settings但不同有效刷新token命中同receipt，改变settings/ref ID/order稳定conflict，token过期只阻止尚无receipt的首次Begin。finalize后再删除源资产仍返回相同submission/pins/provider keys，provider调用不增加。只有submission和preparation都不存在时才读取source snapshot；DB/outbox/errors/raw logs中搜索raw token均为0命中。

recovery先fence-claim现有`preparing|pins_ready` receipt并继续同一command；finalized之后才租约继续outbox。不允许“扫描submitted selection后重建随机task”，也不允许从selection重新Resolve一个preparation。

**Step 3: 收敛 legacy/runtime 两条入口到唯一 executor**

现有 MCP blocking 流与新 bridge 共用 validation/fingerprint/outbox executor，不直接调 Generation Service。用户点击现有生成按钮时，两种 owner 都原子持久 selection decision + outbox与同一`generation.submitted` journal event；runtime owner才给该event附continuation delivery，blocking agent_mcp由原tool waiter返回同一submitted payload且不创建submitted delivery。deferred 路径立即返回 pending 并由 bridge续接。`generate_media(_batch)` 对两种 owner 都只返回已持久 outcome（或 pending），绝不消费 selection、创建 outbox 或调用 provider。用户点击后不等待另一 Agent Run 才提交。

`agent_selection_bridge` 对runtime generation submit不发通用“已确认”observation。若submission尚未建立，明确cancel/expiry、stale token/ref、Artifact supersede或transform/validation失败按selection terminal UoW产生恰好一条稳定ID的`generation.confirmation.cancelled|expired|superseded|failed`结果：runtime owner附continuation delivery；blocking ephemeral owner同事务持久结果/重算Task但不建delivery，原或重连waiter读取terminal row。此时没有submitted、local task acceptance或aggregate terminal。submission一旦建立，权威事实只有确认UoW已写的唯一`generation.submitted`与submission聚合terminal；Bridge只投递runtime owner的submitted delivery，blocking owner由tool return消费，不能双唤醒。aggregate terminal在Workflow/Task仍active时对两种owner都创建唯一continuation，terminal scope只归档。此后的pre-send/dispatch稳定失败通过该聚合terminal表达。local GenerationTask placeholder受理和底层逐task notification不再产生额外Agent wakeup。

**Step 4: 记录 Artifact 并建立 submitted/terminal 多订阅交付**

generating Artifact 与 submission/item/final media task IDs 已在 Decide Unit of Work 内绑定；optimization task 只记 internal lineage，不能作为 Artifact deliverable。测试覆盖 commit 后、local GenerationTask placeholders 建立前崩溃，recovery 可以按已绑定 identity/reservation intent 幂等补建 placeholder。唯一 `generation.submitted` 持久journal event已由 Decide UoW 与 composite outbox/全部 step identity 一起创建，任何 step claim 前必须能读到它；只有runtime owner附submitted continuation delivery，blocking owner用原tool return。确认有效性只校验selection持久scope/ownership、Workflow与Artifact/ref，不要求stored source仍current；Task用Task6事实聚合器同事务重算。测试必须覆盖blocking确认后原Invocation继续且胶囊为running、blocking submitted没有Bridge双唤醒、deferred确认后崩溃仍与waiting_external原子一致，以及`B bound → confirm old A → submission once + B仍running`。传输重投使用同一delivery/command ID，不创建第二次业务效果；aggregate terminal对active scope的两种owner都只有一个delivery。

把现有 success-only 单 listener 改成多订阅 terminal listener，保留逐 task notification subscriber，再追加只消费 submission rollup 的 Agent subscriber。optimization completed只CAS解锁media step，不发Agent terminal；optimization failed/unknown直接终结item；optimization cancelled把item与未启动media step标cancelled/skipped且media provider调用为0；media completed/failed/cancelled/unknown终结item。

每次 item 终态调用 repository tx primitive，但 rollup 业务仍由 service 计算；当全部 items terminal 时，同一数据库事务必须原子写 submission final rollup、Artifact/最终媒体或失败绑定、唯一 aggregate terminal event/delivery，并用同tx external-wait fact重算requester Task。不能先把 submission 标terminal再靠commit后listener补 event/projector；相同terminal fingerprint重放返回原 event，不同则 conflict。两个nonterminal submission中只结束一个仍waiting_external，最后一个结束后若无active/current selection且Task非terminal才离开waiting_external；B active时保持running。terminal journal sequence必须大于submitted并声明delivery dependency：可与submitted在同一continuation batch中按序交付，或等submitted ack后单独交付，绝不能先terminal后submitted。重投只复用同一ID；Task或Workflow终态只归档迟到事实，不创建delivery、不重新唤醒。

测试至少覆盖 optimize success→media success 无双 terminal、optimize failed/unknown/cancelled 不启动 media且只发一次 terminal、普通单项、批次 partial、同步瞬时完成/commit后崩溃/并发 listener均满足 submitted sequence < terminal且各一条，以及底层 notification subscriber仍被调用。

**Step 5: 写重试与模糊提交回归**

provider definite failure、`unknown` 与 pre-send validation failure 后，Agent 若决定再生成，必须用 `retryOfSelectionId` 创建新 pending selection，再次打开同一现有生成弹窗。旧 selection/submission/task/outcome 不变；未确认前 provider 调用为 0，确认后恰好新增一组新 deterministic identities。

**Step 6: 运行 Agent generation 定向测试**

```bash
cd services/server
go test -race ./internal/repository ./internal/service/agentgeneration ./internal/service/selection ./internal/service/generation ./internal/app/mcp ./internal/app -run 'Test.*(AgentGeneration|GenerationPreparation|GenerationBridge|Submission|TerminalListener|Retry|Owner|Observation|PinRecovery|GarbageCollect)' -count=1
cd ../../apps/workspace
pnpm exec vitest run src/domains/agent/hooks/useAgentDecisionQueue.test.ts src/domains/agent/components/AgentDecisionDialogHost.test.tsx src/domains/agent/components/timeline/AgentFormCard.test.tsx
```

Expected: PASS；submission前的cancel/superseded/expired/failed每个selection只有一个稳定terminal outcome且没有submitted/terminal，runtime只有一条delivery、blocking没有delivery且waiter可重读；确认submit不产生通用decision wakeup，runtime submitted走Bridge、blocking submitted只走tool return，aggregate terminal各只有一条权威event/delivery且严格按journal dependency交付；传输重投不重复业务效果。

**Step 7: Commit**

```bash
git add services/server/internal/service/agentgeneration/submission.go services/server/internal/service/agentgeneration/submission_test.go services/server/internal/service/agentgeneration/decide_generation.go services/server/internal/service/agentgeneration/decide_generation_test.go services/server/internal/service/agentgeneration/request_builder.go services/server/internal/service/agentgeneration/request_builder_test.go services/server/internal/repository/agent_generation_tx.go services/server/internal/repository/agent_generation_tx_test.go services/server/internal/app/agent_generation_bridge.go services/server/internal/app/agent_generation_bridge_test.go services/server/internal/domain/workspace_models.go services/server/internal/repository/agent_selection_repo.go services/server/internal/repository/agent_selection_repo_test.go services/server/internal/repository/agent_execution_repo.go services/server/internal/repository/agent_execution_repo_test.go services/server/internal/repository/generation_submission_repo.go services/server/internal/repository/generation_submission_repo_test.go services/server/internal/repository/generation_preparation_repo.go services/server/internal/repository/generation_preparation_repo_test.go services/server/internal/service/generation/generation_preparation_service.go services/server/internal/service/generation/generation_preparation_service_test.go services/server/internal/service/generation/generation_input_pin_service.go services/server/internal/service/generation/generation_input_pin_service_test.go services/server/internal/service/selection/store.go services/server/internal/service/selection/store_test.go services/server/internal/service/selection/workflow_outcome.go services/server/internal/service/selection/workflow_outcome_test.go services/server/internal/service/agent/agent_execution_projector.go services/server/internal/service/agent/agent_execution_projector_test.go services/server/internal/service/agent/agent_workflow_service.go services/server/internal/service/agent/agent_workflow_service_test.go services/server/internal/service/generation/generation_submission_service.go services/server/internal/service/generation/generation_submission_service_test.go services/server/internal/service/generation/generation_tasks_service.go services/server/internal/service/generation/generation_tasks_service_test.go services/server/internal/service/generation/generation_notifications_service.go services/server/internal/service/generation/generation_notifications_service_test.go services/server/internal/app/mcp/generation.go services/server/internal/app/mcp/generation_server.go services/server/internal/app/mcp/generation_test.go services/server/internal/app/mcp/generation_confirmation.go services/server/internal/app/mcp/generation_confirmation_test.go services/server/internal/app/agent_selection_bridge.go services/server/internal/app/agent_selection_bridge_test.go services/server/internal/app/agent_recovery_worker.go services/server/internal/app/wire.go apps/workspace/src/api/types/agent.ts apps/workspace/src/domains/agent/api/agent.ts apps/workspace/src/domains/agent/api/agent.test.ts apps/workspace/src/domains/agent/hooks/useAgentDecisionQueue.ts apps/workspace/src/domains/agent/hooks/useAgentDecisionQueue.test.ts apps/workspace/src/domains/agent/components/AgentPendingDecisionPicker.tsx apps/workspace/src/domains/agent/components/AgentDecisionDialogHost.test.tsx apps/workspace/src/domains/agent/components/timeline/AgentFormCard.tsx apps/workspace/src/domains/agent/components/timeline/AgentFormCard.test.tsx
git commit -m "feat(agent): route confirmed media through durable submissions"
```

## Task 13：更新主 Agent 控制原则与创作/媒体 Skills

**Depends on:** Tasks 4–6 和 12B。

**Files:**

- Modify: `packages/instructions/pkg/official/assets/instructions/AGENTS.md`
- Modify: `packages/instructions/pkg/official/assets/instructions/TOOLS.md`
- Modify: `packages/instructions/pkg/pack/builtin/assets/skills/screenplay-writer.skill.md`
- Modify: `packages/instructions/pkg/pack/builtin/assets/skills/storyboard-writer.skill.md`
- Modify: `packages/instructions/pkg/pack/builtin/assets/skills/image-generation.skill.md`
- Modify: `packages/instructions/pkg/pack/builtin/assets/skills/video-generation.skill.md`
- Modify: `packages/instructions/pkg/official/official_test.go`
- Modify: `packages/instructions/pkg/pack/builtin/builtin_test.go`
- Modify: `services/server/internal/service/prompt/prompt_workspace_test.go`

**Step 1: 写主控制循环失败测试**

固定指令必须表达：识别实际 Goal 和 stop condition；不默认走完整链路；简单任务自己处理；是否委派、并行、重规划由主 Agent决定；原生协作工具执行委派；Workflow MCP 只记录；子 Agent 可发布局部 Artifact/请求决定，但不能改 root Goal/Plan/Task 终态/Workflow 终态；主 Agent用 `record_task_outcome` 和 `complete_goal` 提案，并在严格 `mediago.agent.final.v2` 顶层 root envelope 中提交；“只写剧本”不得进入分镜/媒体。

完成指令还要要求：`complete_goal` 前主 Agent必须为 root 与所有逻辑 child Task 明确提交 terminal outcome；不能把 native Invocation 结束当作 Task 完成。若 Phase 0 未证明 finalization source correlation，主 Agent在 strict final 前必须 wait 或 close 所有已知 active child；不能一边留下不可观察 child，一边宣告 Goal 完成。replace 则允许经已验证事务用 `workflow_replaced` 终止旧 scope 的剩余 Task。

同时锁定Goal边界指令：真正空envelope先`record_goal(create)`；同一目标的新要求用`revise`；独立新目标用带完整successor GoalContract/handoff summary的`replace`。replace始终先返回未应用proposal；主Agent不在旧scope执行新目标的实质工作，并把replace作为rootCommit最后一项。successor已带goal v1，只继续规划执行，不再次create/replace。root Task outcome必须在complete之前进入同一rootCommit；replace/complete合计至多一个且必须最后。

**Step 2: 写重要内容节点规则**

剧本工作默认在创意方向和剧本完成时请求普通 Decision；分镜目标包含分镜时在完成后请求 Decision。用户明确要求不中途确认时可跳过普通内容节点；媒体生成弹窗不能跳过。

**Step 3: 改写媒体 Skills 为 deferred submit**

新流程：构造 intent→`ask_user_form(kind=generation_plan, waitMode=deferred)`→记录 waiting_user 并结束当前 Invocation；用户在现有弹窗点击生成后由 Runtime 直接提交。Agent 不再把 deferred selectionId 跨 Run 传给 `generate_media`。submission建立前的cancel/superseded/expired/failed用唯一selection-scoped confirmation outcome恢复主Agent；建立后runtime owner由`generation.submitted`与整个submission的一次aggregate terminal恢复，local task acceptance/逐task completion不得唤醒。语义 retry 必须用`retryOfSelectionId`创建新弹窗。

保留旧 blocking + `generate_media` 协议的兼容说明，但主端到端路径优先 deferred。provider failure、submission unknown 或 Agent 想要调整参数再生成时，必须用 `retryOfSelectionId` 创建新请求，不能调用旧 image/video retry endpoint。不要加入任何积分/成本/付费提醒。

**Step 4: 锁定“不限制子 Agent”**

指令不能规定固定角色表、最大子 Agent 数、固定并发数或 Runtime dispatch approval。只给模型判断标准，不给服务端闸门。

**Step 5: 运行 instruction tests**

```bash
cd packages/instructions
go test ./... -count=1
cd ../../services/server
go test ./internal/service/prompt -run Test.*Workspace -count=1
```

Expected: PASS。

**Step 6: Commit**

```bash
git add packages/instructions/pkg/official/assets/instructions/AGENTS.md packages/instructions/pkg/official/assets/instructions/TOOLS.md packages/instructions/pkg/pack/builtin/assets/skills/screenplay-writer.skill.md packages/instructions/pkg/pack/builtin/assets/skills/storyboard-writer.skill.md packages/instructions/pkg/pack/builtin/assets/skills/image-generation.skill.md packages/instructions/pkg/pack/builtin/assets/skills/video-generation.skill.md packages/instructions/pkg/official/official_test.go packages/instructions/pkg/pack/builtin/builtin_test.go services/server/internal/service/prompt/prompt_workspace_test.go
git commit -m "feat(agent): teach goal-scoped autonomous execution"
```

## Task 14：完成“只写剧本”最小端到端闭环

**Depends on:** Tasks 3–7、11 和 13。

**Files:**

- Add: `services/server/internal/app/agent_workflow_screenplay_e2e_test.go`
- Add: `apps/workspace/src/domains/agent/components/AgentWorkflowScreenplay.test.tsx`
- Modify: `services/server/internal/app/api_test.go`
- Modify: `apps/workspace/src/domains/agent/components/AgentChat.test.tsx`

**Step 1: 用 fake Agent 写失败的端到端脚本**

脚本顺序：

```text
root run 1:
record_goal(requested=idea+screenplay, excluded=storyboard+image+video)
record_plan(idea -> screenplay -> stop)
publish_artifact(idea v1)
request_decision(idea v1)
top_level_root_final_v2(commits run-1 proposals)
user approve
root continuation 2:
publish_artifact(screenplay v1)
request_decision(screenplay v1)
ordinary_root_final_delivery(no proposals)
user approve
root continuation 3:
record_task_outcome(rootTask, completed)
complete_goal(completed)
top_level_root_final_v2(commits root outcome + complete + durable final delivery)
```

断言共享caller identity未验证的fixture中，`record_goal`、`record_plan`、`record_task_outcome`、`complete_goal`先只记proposal，且每个proposal只能由同origin root run的strict final提交；最终run按顺序提交root outcome再complete后才completed。另加verified caller fixture：create/revise/plan与child Task outcome可direct，但replace/complete/root Task outcome调用后状态仍未变，只有strict final与durable final delivery同事务后才terminal/switch。两次决定可恢复、没有storyboard Artifact、没有generation selection、GenerationTask数为0。伪造child四类写入都不能单独改变语义状态；root引用其JSON也不能通过strict envelope。

**Step 2: 增加 revision 分支**

用户对 screenplay v1 选择 revise；主 Agent发布 v2，v1 Decision superseded，v2 再次确认后完成。Runtime 不自己改写正文或选择重试策略。

**Step 3: 增加简单任务不委派场景**

“润色一句对白”的 fake Agent 只创建 root Task/Invocation 并完成，不出现 child Task；Runtime 没有强制 delegate 调用。

**Step 4: 验证前端交互**

普通 checkpoint 一次只显示一个；approve/revise 结果在聊天中成为只读摘要；剧本完成后没有媒体弹窗。

**Step 5: 运行 vertical slice tests**

```bash
cd services/server
go test -race ./internal/app -run TestAgentWorkflowScreenplay -count=1
cd ../../apps/workspace
pnpm exec vitest run src/domains/agent/components/AgentWorkflowScreenplay.test.tsx src/domains/agent/components/AgentChat.test.tsx
```

Expected: PASS。

**Step 6: Commit**

```bash
git add services/server/internal/app/agent_workflow_screenplay_e2e_test.go services/server/internal/app/api_test.go apps/workspace/src/domains/agent/components/AgentWorkflowScreenplay.test.tsx apps/workspace/src/domains/agent/components/AgentChat.test.tsx
git commit -m "test(agent): cover screenplay-only workflow boundary"
```

## Task 15：覆盖并发确认、媒体重试与重启恢复

**Depends on:** Tasks 7–14，包括 12A/12B。

**Files:**

- Add: `services/server/internal/app/agent_workflow_concurrency_e2e_test.go`
- Add: `services/server/internal/app/agent_workflow_generation_e2e_test.go`
- Add: `services/server/internal/app/agent_workflow_recovery_e2e_test.go`
- Add: `apps/workspace/src/domains/agent/components/AgentWorkflowConcurrency.test.tsx`
- Add: `apps/workspace/src/domains/agent/components/AgentWorkflowScope.test.tsx`
- Add: `apps/workspace/src/domains/agent/components/AgentWorkflowRecovery.test.tsx`

**Step 1: 写两个 child Task 同时确认测试**

按 Phase 0 `projectionMode` 分支。rich 模式：两个 child Invocation 结束并留下两个 waiting_user Task，第三个 Task继续 running；两个 pending selection都可见，用户先激活第二个并决定，再处理第一个；Workflow一直 active，Invocation不从 terminal回退。再让一个 child Invocation失败：对应 Task只进入 `needs_attention`，主 Agent在同 Task下创建新 Invocation成功恢复。`ordinary_tool_only`：相同 ACP fixture 只显示普通 tool/activity，不产生 child Task/胶囊/Sheet；另用两个合法 durable selection 验证决定队列仍可任意顺序处理。

在同 project 创建第二个 session/Workflow/pending selection；当前聊天的 API、SWR 队列与 Decide 不可见/不可操作另一作用域。

**Step 2: 写 active root 下 observation 排队测试**

root Run 忙时两个决定到达，inbox 保存两条；root terminal 后只启动一个 continuation drain，main Agent 同时收到两个带稳定 delivery ID 的 correlation。分别在 lease claim 后、ACP accepted 后与 continuation terminal 前注入崩溃；过期后以同 delivery ID 重投，后续稳定 commandId 不重复产生业务效果。accepted/start 只是 delivered，成功 terminal receipt 后才 ack。

**Step 3: 写 generation 全闭环测试**

- 弹窗 dismiss：selection pending，任务数 0。
- 显式 cancel：selection cancelled，任务数 0，主 Agent收到取消。
- stale token/ref、Artifact supersede与transform/validation失败：selection按稳定原因终结、任务数/provider调用均为0；runtime owner各只收到一条selection-scoped outcome，blocking owner只返回原waiter，二者都没有submitted/aggregate terminal。
- 点击生成：先持久同command的`AgentGenerationPreparation`和frozen plan/deterministic pin IDs；pin ready后，Decision + outbox + 有序deterministic step identities/reservation intents + `generation.submitted`在Finalize事务原子落库并把receipt置finalized。实际GenerationTask placeholder rows可由worker随后幂等补建。Runtime用最终参数提交，无第二个Agent submit call、无通用decision wakeup；preparing/pins_ready期间provider调用为0。
- Task factual aggregate：blocking owner确认后原source仍active且没有同source pending时回running；deferred source已terminal且submission非终态时进入waiting_external；若B已绑定，确认A仍只创建一次submission且B保持running。两个submission只终结一个仍waiting_external，最后一个终结才离开该状态。
- `generation.submitted` 每 submission 只创建一条权威事件且 sequence 先于 terminal；optimization completed 不发 Agent terminal，optimization failed/unknown/cancelled 或最终 media/batch rollup 只产生一条 submission terminal。dependency 保证同步瞬时完成时也先交付 submitted；传输重投复用稳定ID，现有逐 task notification subscriber仍被调用。
- 弹窗最终增删 refs 后，每个 ordered ID 必须携带 opaque snapshot token；打开/选中后 replace/delete 任一 ref 时确认 supersede且 provider=0，并只产生一条selection-scoped superseded outcome。确认后变更源资产/压缩默认值仍提交 provider-ready pin 的相同 payload hash；当前route catalog变化时仍按frozen plan提交相同payload，只有冻结adapter contract不可用/不兼容时provider=0并要求重确认。
- 可恢复 provider 崩溃后使用同一持久 key 对账且 Generate 不重复；不可恢复 provider 的 expired `sending` 进入 `unknown`，Generate 调用数仍为 1。
- provider failure/unknown 后 Agent request retry：新 selectionId、新弹窗；未确认前任务数不变。旧 retry endpoint 返回 409 且不修改旧 task。
- retry 确认后只新增一个 task/submission/provider key。
- 相同 confirm/command 并发与网络重放命中同一 IDs，不重复任务。
- 首次 confirm commit 后丢响应并删除源素材，再重放同 command 时 lookup-first 返回原 submission/pins/provider keys，不读取 live ref、不增加 provider调用。
- preparation commit、任一pin rename、pins_ready、finalize commit四个切点崩溃后，相同canonical payload恢复使用server-derived的同preparation/plan/namespace/pin IDs；旧fence不能写，20个并发confirm只完成一份manifest/一个submission。expired preparation lease与GC并发时`preparing|pins_ready`文件不丢，finalized前provider调用为0。
- preparation active期间刷新、worker pause或第二tab：selection DTO带processing phase，但不进入自动弹窗/picker/可操作待确认数；blocking owner的active Invocation保持running，deferred无current时Task为waiting_external。客户端不生成commandId，相同canonical payload命中server-derived receipt，response在receipt commit前/后丢失都可重放，不同payload conflict。
- 同settings/ordered refs但刷新token不同仍命中同semantic fingerprint/receipt；改settings、ref ID或ordinal才conflict。token过期只阻止首次Begin，existing receipt lookup仍成功；raw token在DB JSON、outbox、error与raw log中均不存在。
- explicit cancel、expiry、Artifact supersede、Task terminal、Workflow cancel/replace分别与preparing、pins_ready、Finalize并发：只有finalized submission或failed receipt+唯一pre-submission outcome之一；loser fence失败，0重复delivery，未finalized分支provider=0且receipt最终可GC。

**Step 4: 写进程重启恢复测试**

分别在pending decision、preparation commit后、任一pin atomic rename后、pins_ready后、Finalize的Decision+outbox+step reservation intents事务commit后但GenerationTask placeholder尚未补建、`sending`后尚未保存provider response、task terminal后尚未交付observation等切点重建service。验证preparation/submission/task/pin IDs不变，GC不删除active receipt，可恢复provider只对账，不可恢复provider进入unknown，submitted/terminal delivery各至少一次、严格按依赖顺序且业务效果幂等。不再使用“claim后查随机task”或从selection重新Resolve route/pins的假恢复。

另覆盖workflow生命周期切点：terminal/replace与已leased continuation竞态时最终dispatch CAS失败且事件持久`discarded`；`complete_goal`在任一Task非终态时全量拒绝，同一rootCommit先终结全部Task后才成功，replace/显式cancel bulk-cancel旧scope Task。replace handoff分别在claim后sending前、sending commit后ACP调用前、ACP accepted后started CAS前、首条messageId echo/update后CAS前、started CAS后runner绑定前崩溃；pending/expired leased只启动同一确定性successor，generic interruption scan不触碰其预建Invocation，run/message/session/dispatch ID均不变且empty response不重发。sending恢复覆盖fixture lookup found→started、authoritative definitely-absent→pending、unsupported/inconclusive→unknown；unknown时新消息、continuation和generic scan都不能启动第二个Invocation，queued barrier保持，只有显式reconcile/cancel能解除。failed_definite只在证明未send时把原请求转成recovery input；无新消息、紧接新消息和重启都不丢。

replace barrier期间用户消息只先写queued display payload；predecessor final published后才按accepted order journal，再允许successor lifecycle。断言`predecessor message.completed < predecessor run.completed < queued user events < successor accepted/started`，三条queued input的第一条再触发replace/complete时，后两条dispatch前重读最新pointer、跨新barrier仍按序且不进旧scope。replace command replay无第二个Workflow且不覆盖goal v1；replace与complete并发只有一个成功；旧scope迟到Invocation只能记历史。unknown recovery GET/POST覆盖project+session作用域、旧revision、同command同/异payload、重复cancel和重复reconcile；reconcile调用ACP lookup次数可审计且Prompt send始终为0，cancel不重排原Prompt、只放行已有queued inputs。前端只在当前session任务区显示一条notice，Sheet可关闭，无额外AlertDialog；lookup unsupported时不显示重新检查。

root-final覆盖ordinary/strict的DB commit→append前、JSON中途torn tail、完整JSON缺newline、newline→fsync数据保留/丢失、fsync→journaled CAS、journaled→fanout、fanout→published CAS、双publisher lease、同event ID同/异payload与非尾部损坏。只有尾部可修复，bundle sequence连续且JSONL append once；fanout后崩溃允许相同event ID/sequence的wire SSE至少一次重放，但hydrate/stream/store可见投影恰好一次。identity矩阵覆盖同ID/sequence/fingerprint重放去重、同event ID映射不同sequence、同sequence映射不同event ID或同ID/sequence不同fingerprint均fail closed、hydrate播种cache后的SSE重放、legacy无fingerprint按sequence兼容，以及新RootFinalDelivery bundle缺fingerprint拒绝。`pending|journaled|failed` barrier期间successor/root/continuation lifecycle为0。failed时completed root Task不回退，session只显示一条root-final recovery notice；底层仍损坏时reconcile保持failed，外部修复并全量验证后只恢复同一bundle。project/session/delivery不匹配、旧revision、相同command异payload均拒绝，相同command网络重放返回同一结果；UI无跳过动作，Sheet可关闭，新建会话不迁移旧queued inputs。proposal seal后崩溃只有在root-run/session lease过期且超过timeout才rejected/needs_attention，活lease不被scan误杀；双runner只有一个seal，late child与seal竞态不留pending proposal；零proposal且尚未ordinary expire的root崩溃同样rejected并封死迟到insert。外部WorkspaceDocument被手工编辑后，即使Agent没有`publish_artifact`，旧selection也在list/Decide时supersede。Task A迟到失败不能覆盖正在运行的B，terminal Task不被任何迟到事件重开。

**Step 5: 运行 E2E/race tests**

```bash
cd services/server
go test -race ./internal/app -run 'TestAgentWorkflow(Concurrency|Generation|Recovery)' -count=1
cd ../../apps/workspace
pnpm exec vitest run src/domains/agent/components/AgentWorkflowConcurrency.test.tsx src/domains/agent/components/AgentWorkflowScope.test.tsx src/domains/agent/components/AgentWorkflowRecovery.test.tsx
```

Expected: PASS。

**Step 6: Commit**

```bash
git add services/server/internal/app/agent_workflow_concurrency_e2e_test.go services/server/internal/app/agent_workflow_generation_e2e_test.go services/server/internal/app/agent_workflow_recovery_e2e_test.go apps/workspace/src/domains/agent/components/AgentWorkflowConcurrency.test.tsx apps/workspace/src/domains/agent/components/AgentWorkflowScope.test.tsx apps/workspace/src/domains/agent/components/AgentWorkflowRecovery.test.tsx
git commit -m "test(agent): cover concurrent decisions and recovery"
```

## Task 16：执行完整质量门禁与人工 UI 验收

**Depends on:** Task 15。

**Files:**

- Modify only if a gate exposes a real defect; do not make speculative cleanup changes.

**Step 1: 验证 MCP 和 instructions**

```bash
cd packages/mcp
go test -race ./...
cd ../../packages/instructions
go test -race ./...
```

Expected: PASS。

**Step 2: 验证后端**

```bash
cd services/server
task check
```

Expected: gofmt、vet、golangci-lint、build、swagger 和 `go test -race ./...` 全部通过。

**Step 3: 验证 workspace 前端**

```bash
cd apps/workspace
pnpm test
pnpm lint
pnpm format
pnpm build
```

Expected: 全部通过。

**Step 4: 真实浏览器验收**

在本地应用完成以下检查：

1. rich projection：子 Agent胶囊在原聊天中原地更新；`ordinary_tool_only`：只显示普通 ACP tool/activity且没有伪胶囊。
2. rich projection：点击胶囊打开右侧 Sheet，关闭后布局恢复；降级模式没有 Sheet 入口。
3. 两个 pending决定默认逐一弹出，也能从任务区任选顺序；rich模式还可从胶囊进入，降级模式不依赖胶囊。
4. X/Escape 是“稍后”，现有“取消”按钮才取消。
5. 图片/视频只出现现有生成设置，无积分/成本/付费提醒、无二次弹窗。
6. 点击生成只创建一次任务；重试再次弹同类设置。
7. “只写剧本”确认后结束，不出现分镜或媒体。
8. 同项目另一聊天的待确认不在当前聊天弹出。
9. 一次媒体确认只有一条 submitted 状态；失败/unknown 后不自动重发，只能重开现有弹窗。

**Step 5: 检查变更边界**

```bash
git diff --check
git status --short
```

Expected: 无 whitespace error；没有修改 vendored adapter，除非另有已接受 ADR；没有混入用户原有不相关文件。

**Step 6: Commit gate fixes only if needed**

```bash
git add <only-files-fixed-for-gates>
git commit -m "fix(agent): satisfy orchestration quality gates"
```

如果所有门禁首次即通过，不创建空提交。

## 完成定义

- 主 Agent 能记录并修订目标/计划、直接处理简单任务并自由使用原生子 Agent。
- Runtime 中不存在决定委派、并发、阶段解锁、语义重试或 Goal 完成的 scheduler 代码。
- “只写剧本”在剧本确认后结束；范围由 GoalContract 决定。
- 逻辑 Task 与单次 Invocation 分离，任何 Invocation 终态都不会回退。
- 多个 durable 决定独立等待，用户可选择处理顺序，其他任务继续运行。
- 决定队列严格隔离 project/session/active Workflow，不串聊天。
- 现有生成参数弹窗是唯一媒体确认；无积分/成本/付费提示。
- 用户点击生成后 Runtime 原子持久 outbox 和 deterministic task/provider identity；失败重试必须新 selection 和新弹窗。
- provider 支持幂等恢复时复用持久 key；不支持时模糊调用 fail closed 为 unknown，永不盲目重提。
- 服务重启不会丢 Goal、Task、Invocation、Artifact、pending Decision、submission outbox 或未 ack observation。
- ACP 证据不足时诚实降级，不伪造子 Agent UI。
- 全部 Go/React 质量门禁和真实 UI 验收通过。
