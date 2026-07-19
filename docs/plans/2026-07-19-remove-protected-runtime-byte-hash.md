# Remove Protected Runtime Byte Hash Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent macOS signing from breaking protected skill-pack imports by removing the Runtime's raw executable byte-hash check.

**Architecture:** Private release artifacts remain pinned and verified before staging, while packaged execution relies on the platform-signed application boundary. The Go adapter validates the executable path and importer protocol but no longer receives or rechecks a pre-signing SHA-256 value.

**Tech Stack:** Go, Electron Builder, Node.js build scripts, GitHub Actions release preparation

---

### Task 1: Lock the importer contract with tests

**Files:**

- Modify: `services/server/internal/platform/protectedpack/importer_test.go`

**Steps:**

1. Replace digest-specific constructor tests with cases for an executable regular file, a missing file, and a directory.
2. Run `go test ./services/server/internal/platform/protectedpack` and confirm the new constructor call fails to compile before implementation.

### Task 2: Remove runtime byte hashing

**Files:**

- Modify: `services/server/internal/platform/protectedpack/importer.go`
- Modify: `services/server/internal/app/app.go`
- Modify: `services/server/internal/app/wire.go`
- Modify: `services/server/cmd/mediago-server/main.go`
- Modify: `scripts/build-server-target.mjs`

**Steps:**

1. Remove the expected digest field, digest verifier, and repeated pre-import check.
2. Simplify `protectedpack.New` to accept only the executable path.
3. Remove the digest from server configuration and build-time linker flags.
4. Log importer initialization failures with the resolved path and cause.
5. Run focused Go tests and formatting.

### Task 3: Align release documentation

**Files:**

- Modify: `docs/prompt-pack-runtime-policies.md`

**Steps:**

1. Keep the private release download and archive verification guarantees.
2. Remove claims that the server embeds and repeatedly validates the Runtime binary digest.
3. Document that packaged Runtime files follow the same platform trust boundary as other sidecars.

### Task 4: Verify the change

**Steps:**

1. Add an upload prerequisite that runs `codesign --verify --deep --strict` against the completed macOS App bundle.
2. Unit-test deterministic App path resolution in the release verification script.
3. Run `go test ./services/server/internal/platform/protectedpack ./services/server/internal/app ./services/server/cmd/mediago-server`.
4. Run `go test ./services/server/internal/service/promptpack ./services/server/internal/http/handlers`.
5. Run `gofmt` on changed Go files and `go vet` on affected packages.
6. Run workflow script tests, `git diff --check`, and inspect the final diff for unrelated changes.
