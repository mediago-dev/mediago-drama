# Official Codex ACP Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Package `@agentclientprotocol/codex-acp@1.1.2` with `@openai/codex@0.144.0` as an offline desktop agent.

**Architecture:** Build the npm adapter into a standalone Bun executable during vendor preparation, package the platform Codex distribution beside it, and pass its resolved path through `CODEX_PATH`. Preserve the existing ACP stdio client and relay-specific `CODEX_HOME` configuration.

**Tech Stack:** Go, npm registry archives, Bun compile, Electron resources, ACP stdio.

---

### Task 1: Extend the pinned agent specification

**Files:**
- Modify: `packages/vendor/agents.json`
- Modify: `packages/vendor/cmd/prepare-agent/main.go`
- Test: `packages/vendor/cmd/prepare-agent/main_test.go`

**Steps:**
1. Add failing parsing and platform mapping tests for npm adapter, Codex, and Bun versions.
2. Run the vendor tests and confirm the new assertions fail.
3. Add distribution metadata and platform target helpers.
4. Run the targeted tests and confirm they pass.

### Task 2: Build and install the official adapter

**Files:**
- Modify: `packages/vendor/cmd/prepare-agent/main.go`
- Test: `packages/vendor/cmd/prepare-agent/main_test.go`
- Modify: `packages/vendor/README.md`

**Steps:**
1. Add tests for npm metadata URL resolution, manifest companion validation, and cache invalidation.
2. Implement registry metadata download, safe archive extraction, pinned Bun compilation, and Codex vendor installation.
3. Run `task -d packages/vendor prepare AGENT=codex` and verify both executables and manifest versions.
4. Run the compiled adapter with `CODEX_PATH` and verify `--version`.

### Task 3: Inject the packaged Codex path at runtime

**Files:**
- Modify: `services/server/internal/service/agent/agent_backends.go`
- Test: `services/server/internal/service/agent/agent_backends_test.go`
- Modify: `services/server/internal/app/wire.go`
- Test: `services/server/internal/app/api_test.go`

**Steps:**
1. Add a failing backend test for resolving `codexBin` to `CODEX_PATH`.
2. Extend manifest validation and expose the active vendored environment.
3. Merge the vendored environment into relay process configuration.
4. Run agent and app tests.

### Task 4: Verify ACP compatibility and packaging

**Files:**
- Modify if required: `services/server/internal/service/acp/*`
- Modify: `.github/workflows/electron-release.yml`

**Steps:**
1. Run an ACP initialize/new-session probe with the new adapter and Codex 0.144.0.
2. Add Bun availability to release builds if the pinned on-demand builder is insufficient.
3. Run vendor checks, server checks, frontend checks, and a desktop resource staging check.
4. Verify the staged manifest reports adapter 1.1.2 and Codex 0.144.0 and that GPT-5.6 metadata is embedded.
