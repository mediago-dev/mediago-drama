# Agent Final Answer Phase Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep ACP final-answer chunks outside the collapsible process disclosure in both the live timeline and restored transcripts.

**Architecture:** Preserve the Codex ACP `_meta.codex.phase` value when converting `agent_message_chunk` updates into agent events. Project streamed assistant records by semantic item identity instead of one conversation-wide streaming ID, while retaining completion-time promotion as a compatibility fallback for runtimes that omit phase metadata.

**Tech Stack:** Go, coder/acp-go-sdk, MediaGo agent event projection, standard Go tests.

---

### Task 1: Preserve ACP phase metadata

**Files:**
- Modify: `services/server/internal/service/acp/acp_client_updates.go`
- Test: `services/server/internal/service/acp/acp_runner_test.go`

1. Add a failing test that sends a message chunk with `_meta.codex.phase=final_answer` and expects the published delta event to retain `final_answer`.
2. Run the focused ACP test and confirm it fails because the event is currently normalized as commentary.
3. Add a small metadata parser that accepts only `commentary` and `final_answer`, then set the event phase before semantic normalization.
4. Re-run the focused ACP tests and confirm legacy chunks without metadata still default to commentary.

### Task 2: Separate streamed transcript items

**Files:**
- Modify: `services/server/internal/service/agent/agent_event_projection_conversation.go`
- Test: `services/server/internal/service/agent/agent_event_projection_test.go`

1. Add a failing projection test with a commentary item followed by a different final-answer item.
2. Verify the current projector incorrectly appends both items into the conversation-wide streaming record.
3. Select streaming records by semantic item ID, completing the previous record when a new item begins.
4. Verify completion updates the matching final item without merging the earlier commentary.
5. Preserve whitespace-only deltas so Markdown line and paragraph boundaries survive transcript refresh.

### Task 3: Verification

**Files:**
- Verify only; no additional production files expected.

1. Run focused ACP and agent projection tests.
2. Run the complete service test suite with race detection through `task test`.
3. Run `task check` and `task build` from `services/server`.
4. Review `git diff` to ensure unrelated existing changes were preserved.

No commit or staging step is included because the user requested the fix, not repository publication.
