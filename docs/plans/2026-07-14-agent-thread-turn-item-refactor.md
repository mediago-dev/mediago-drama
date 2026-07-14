# Agent Thread / Turn / Item Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the flat Agent message timeline with a compatible Thread / Turn / Item protocol and a Codex-style turn-level process disclosure.

**Architecture:** Keep the existing session event log, SSE sequence reconciliation, permission ownership, and terminal recovery intact. Add stable turn/item identity and phase to current event types, normalize new and legacy transcripts into Turn View Models, then render one ProcessDisclosure per turn with final and interactive lanes outside it.

**Tech Stack:** Go 1.25, Gin, ACP Go SDK v0.13.5, React 19, TypeScript, Zustand, Vitest, Tailwind CSS v4.

---

### Task 1: Pin the new wire identity and legacy compatibility

**Files:**
- Modify: `services/server/internal/service/agent/agent_svc.go`
- Modify: `apps/workspace/src/api/types/agent.ts`
- Modify: `apps/workspace/src/domains/agent/stores/types.ts`
- Modify: `apps/workspace/src/api/types/__fixtures__/agent-wire-contract.json`
- Test: `services/server/internal/service/agent/wire_contract_test.go`
- Test: `apps/workspace/src/api/types/agent-wire-contract.test.ts`

**Steps:**
1. Add failing contract expectations for `turnId`, `itemId`, and `phase` on persisted chat messages and live events.
2. Run the Go and TypeScript wire-contract tests and confirm the fixture drift fails.
3. Add additive optional fields and closed TypeScript unions without removing legacy fields.
4. Run both contract tests and confirm they pass.

### Task 2: Normalize server events into stable Turn / Item semantics

**Files:**
- Modify: `services/server/internal/service/agent/agent_event_bus.go`
- Modify: `services/server/internal/service/agent/agent_event_projection.go`
- Modify: `services/server/internal/service/agent/agent_event_projection_acp.go`
- Modify: `services/server/internal/service/agent/agent_event_projection_conversation.go`
- Test: `services/server/internal/service/agent/agent_event_bus_test.go`
- Test: `services/server/internal/service/agent/agent_event_projection_test.go`

**Steps:**
1. Add failing tests proving `sessionId → thread`, `runId → turn`, toolCallId/messageId → item, and legacy fallback IDs.
2. Add projection tests for repeated tool/message updates remaining one item and explicit phase surviving persistence.
3. Implement a single semantic normalizer called after run decoration and during legacy event reads.
4. Ensure every projected chat message carries the normalized identity and phase.
5. Run focused service tests.

### Task 3: Preserve ACP message identity and terminal outcome

**Files:**
- Modify: `services/server/internal/service/acp/acp_runner.go`
- Modify: `services/server/internal/service/acp/acp_client_state.go`
- Modify: `services/server/internal/service/acp/acp_client_updates.go`
- Modify: `services/server/internal/service/acp/acp_runner_run.go`
- Modify: `services/server/internal/service/agent/agent_runtime.go`
- Test: `services/server/internal/service/acp/acp_runner_test.go`
- Test: `services/server/internal/service/agent/agent_runtime_test.go`

**Steps:**
1. Add failing tests for SDK messageId propagation, stable fallback across chunks, thought identity, and completion reusing the streamed item ID.
2. Add failing table tests for end_turn, cancelled, max_tokens, max_turn_requests, refusal, and runner errors.
3. Track the active and last assistant item ID under the existing client mutex.
4. Return message item ID and stop reason in `AgentRunResult`; attach normalized outcome to the existing terminal event types.
5. Run focused ACP/runtime tests with race detection.

### Task 4: Build the pure transcript-to-turn adapter

**Files:**
- Create: `apps/workspace/src/domains/agent/lib/agent-thread-adapter.ts`
- Create: `apps/workspace/src/domains/agent/lib/agent-thread-adapter.test.ts`
- Replace: `apps/workspace/src/domains/agent/components/timeline/model.ts`
- Modify: `apps/workspace/src/domains/agent/components/timeline/model.test.ts`

**Steps:**
1. Add failing tests for explicit commentary/final lanes, multi-user turns, orphan assistant content, interaction items, runtime filtering, and deterministic legacy IDs.
2. Add tests proving a short final and long commentary never use content length or Markdown syntax.
3. Implement deterministic Turn construction and legacy `<think>` splitting.
4. Derive lifecycle, outcome, duration, process summary, and lane arrays without React dependencies.
5. Run the adapter/model tests.

### Task 5: Make live streaming item-aware

**Files:**
- Modify: `apps/workspace/src/domains/agent/stores/types.ts`
- Modify: `apps/workspace/src/domains/agent/stores/conversation.ts`
- Modify: `apps/workspace/src/domains/agent/stores/lifecycle-actions.ts`
- Modify: `apps/workspace/src/domains/agent/stores/activity-actions.ts`
- Modify: `apps/workspace/src/domains/agent/stores/tool-metadata.ts`
- Modify: `apps/workspace/src/domains/agent/lib/streaming-events.ts`
- Test: `apps/workspace/src/domains/agent/stores/conversation.test.ts`
- Test: `apps/workspace/src/domains/agent/stores/store.test.ts`
- Test: `apps/workspace/src/domains/agent/lib/controller.test.ts`

**Steps:**
1. Add failing tests for delta buffers isolated by `turnId:itemId:phase`, exact completion, and idempotent replay updates.
2. Preserve streaming status during a running hydrate and only repair stale streaming items for terminal turns.
3. Pass event identity into append/complete/thought/plan/tool actions and upsert by item ID.
4. Stop using a new tool as an implicit completion signal for an unrelated assistant item.
5. Keep the existing `applyEventSequence` implementation as the single cursor/gap authority.
6. Run focused store/controller tests.

### Task 6: Implement the unified ProcessDisclosure

**Files:**
- Create: `apps/workspace/src/domains/agent/components/timeline/ProcessDisclosure.tsx`
- Create: `apps/workspace/src/domains/agent/components/timeline/ProcessDisclosure.test.tsx`
- Create: `apps/workspace/src/domains/agent/components/timeline/ProcessItemRow.tsx`
- Modify: `apps/workspace/src/domains/agent/components/timeline/ThoughtBlock.tsx`
- Modify: `apps/workspace/src/domains/agent/components/timeline/ToolGroup.tsx`
- Modify: `apps/workspace/src/domains/agent/components/timeline/ToolCallCard.tsx`

**Steps:**
1. Add failing lifecycle, manual override, focus retention, ARIA, and keyboard tests.
2. Implement auto/manual-open/manual-closed state with focus-within protection.
3. Render thought, commentary, plan, file, command, tool, and runtime rows as one continuous process body.
4. Remove thought/action/tool group top-level cards and retain only tool detail expansion.
5. Run component tests.

### Task 7: Replace the timeline with Turn rendering

**Files:**
- Modify: `apps/workspace/src/domains/agent/components/AgentTimeline.tsx`
- Modify: `apps/workspace/src/domains/agent/components/AgentTimeline.test.tsx`
- Modify: `apps/workspace/src/domains/agent/components/AgentChat.tsx`

**Steps:**
1. Add failing tests for one disclosure per Turn, final outside, interaction outside, and historical completion folding.
2. Render one virtualized row per Turn instead of alternating user/assistant groups.
3. Hoist disclosure overrides by turnId so Virtuoso unmounts do not reset user choices.
4. Delete `isRichAssistantMarkdown` and component-level inline-thought classification.
5. Preserve permission A2UI suppression and runtime alert ownership.
6. Run timeline/chat tests.

### Task 8: Refine design tokens and responsive states

**Files:**
- Modify: `apps/workspace/src/styles/tokens.css`
- Modify: `apps/workspace/src/styles/index.css`

**Steps:**
1. Add semantic process/disclosure tokens for light and dark themes.
2. Replace card-heavy Agent styles with a low-surface inline flow and one divider.
3. Add hover, focus-visible, running, failure, narrow-width, and reduced-motion states.
4. Confirm no new component CSS uses hex/rgb values outside the token palette.

### Task 9: Verify reliability and visual acceptance

**Files:**
- Verify all modified files.

**Steps:**
1. Run focused Go and Vitest suites after every task.
2. Run the complete Agent/SSE/permission/form regression matrix.
3. Run `pnpm lint`, `pnpm format`, `pnpm test`, and `pnpm build` in `apps/workspace`.
4. Run `task check`, `task test`, and `task build` in `services/server`.
5. Start the real workspace UI, inspect running/completed/failed turns at desktop and narrow widths, and capture screenshots.
6. Review `git diff --check`, `git diff`, and `git status` to confirm only scoped files changed.
