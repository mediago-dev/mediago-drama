# ACP Native Instructions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver fixed MediaGo Agent instructions through Codex/OpenCode native runtime configuration and keep ACP prompts incremental.

**Architecture:** The ACP runner renders fixed instructions once and passes them to the backend process configuration provider. Codex and OpenCode explicitly acknowledge native injection; unsupported backends retain the inline prefix. A versioned instruction fingerprint prevents incompatible ACP sessions from being resumed.

**Tech Stack:** Go, ACP Go SDK, JSON, generated OpenCode configuration, Gorm/SQLite.

---

### Task 1: Define runner delivery contracts

**Files:**
- Modify: `services/server/internal/service/acp/acp_runner.go`
- Modify: `services/server/internal/service/acp/acp_runner_run.go`
- Test: `services/server/internal/service/acp/acp_runner_test.go`

**Step 1: Write failing tests**

Assert that fixed instructions reach `ProcessConfigRequest`, native delivery emits
only `BuildACPUserPrompt`, and unacknowledged delivery retains the old prefix.

**Step 2: Run the targeted tests**

Run: `go test ./internal/service/acp -run 'ProcessConfigPassesFixedInstructions|BuildPromptForRequest' -count=1`

Expected: FAIL because the delivery acknowledgement and split prompt API do not
exist yet.

**Step 3: Implement the minimal contracts**

Add `FixedInstructions`, `NativeInstructionsInjected`, one-time rendering, and a
prompt builder that selects native or fallback shape.

**Step 4: Rerun the targeted tests**

Expected: PASS.

### Task 2: Add Codex native instruction merging

**Files:**
- Modify: `services/server/internal/app/wire.go`
- Test: `services/server/internal/app/wire_test.go`

**Step 1: Write failing merge tests**

Cover replacement of an old developer instruction, preservation of unknown fields
and a `9007199254740993` integer, inherited environment input, and rejection of
malformed/array/null JSON.

**Step 2: Run the targeted tests**

Run: `go test ./internal/app -run 'CodexConfig' -count=1`

Expected: FAIL because the merge helper does not exist.

**Step 3: Implement RawMessage overlay**

Clone the process environment, parse an object, encode the fixed text as a JSON
string, replace `developer_instructions`, and return an actionable error for bad
input. Set `NativeInstructionsInjected` only after success.

**Step 4: Rerun the targeted tests**

Expected: PASS.

### Task 3: Add OpenCode managed instruction files

**Files:**
- Modify: `services/server/internal/service/settings/agent_model_profiles.go`
- Test: `services/server/internal/service/settings/agent_model_profiles_test.go`
- Modify: `services/server/internal/app/wire.go`

**Step 1: Write failing configuration tests**

Verify an absolute managed instruction path, exact body, POSIX mode 0600, JSON
without the instruction body, configuration creation when no model profile
exists, and isolated directories for concurrent variants.

**Step 2: Run the targeted tests**

Run: `go test ./internal/service/settings -run 'OpenCodeRuntimeConfig.*Instructions' -count=1`

Expected: FAIL because generated configs have no `instructions` field.

**Step 3: Implement managed files**

Create a content-addressed runtime directory through atomic staging, write the
Markdown file, add its final absolute path to `openCodeConfigFile`, and keep the
old empty-config behavior only when both profiles and instructions are absent.

**Step 4: Rerun the targeted tests**

Expected: PASS.

### Task 4: Version reusable ACP sessions

**Files:**
- Modify: `services/server/internal/domain/agent_models.go`
- Modify: `services/server/internal/service/agent/agent_sessions_service.go`
- Modify: `services/server/internal/service/agent/agent_session_persistence.go`
- Modify: `services/server/internal/service/agent/agent_runtime.go`
- Modify: `services/server/internal/service/agent/agent_svc.go`
- Modify: `services/server/internal/service/chat/store.go`
- Test: `services/server/internal/service/agent/agent_sessions_service_test.go`
- Test: `services/server/internal/service/acp/acp_runner_test.go`

**Step 1: Write failing state tests**

Assert fingerprint storage, load, finish propagation, and clearing. Assert the
runner generates stable hashes and discards a prior session on mismatch.

**Step 2: Run targeted tests**

Run: `go test ./internal/service/agent ./internal/service/acp -run 'InstructionFingerprint|ACPState' -count=1`

Expected: FAIL because the fingerprint is not represented.

**Step 3: Implement state propagation**

Add the database column and internal fields, pass the stored value into the run,
return the new value, and persist/clear ID and fingerprint atomically.

**Step 4: Rerun targeted tests**

Expected: PASS.

### Task 5: Add an operator rollback setting

**Files:**
- Modify: `services/server/internal/config/config.go`
- Modify: `services/server/internal/config/config_test.go`
- Modify: `services/server/configs/server.yaml`
- Modify: `services/server/internal/app/app.go`
- Modify: `services/server/cmd/mediago-server/main.go`
- Modify: `services/server/internal/app/wire.go`

**Step 1: Write failing config tests**

Assert the default is `native`, YAML accepts trimmed `inline`, and an unknown
value normalizes to `native`.

**Step 2: Implement and route the setting**

Pass `prompt.instruction_delivery` into app wiring. Inline mode must skip native
backend mutation and leave `NativeInstructionsInjected` false.

**Step 3: Run config and app tests**

Run: `go test ./internal/config ./internal/app -count=1`

Expected: PASS.

### Task 6: Verify the complete server change

**Files:**
- Inspect all modified files.

**Step 1: Format**

Run: `gofmt -w <modified-go-files>`

**Step 2: Run package tests**

Run: `go test ./internal/service/acp ./internal/service/settings ./internal/service/agent ./internal/app ./internal/config -count=1`

Expected: PASS.

**Step 3: Run full verification**

Run: `go test ./... -count=1`

Run: `go vet ./...`

Run: `go build ./...`

Expected: all commands exit 0. If the workspace-distribution build tag requires a
prebuilt frontend, report it separately rather than hiding the failure.

**Step 4: Review the diff**

Confirm no fixed prompt body enters the native `PromptRequest`, no secrets or
instruction bodies are logged by MediaGo, and only intended files changed.
