# Remove Sidecar Runtime Integrity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the self-managed sidecar integrity manifest and rely on the signed macOS application as the release trust boundary.

**Architecture:** Electron checks that `mediago-server` exists and reports real process launch errors, but it no longer hashes or code-sign-verifies sidecars at runtime. Staging copies executable sidecars without producing an integrity manifest. Electron Builder signs macOS releases with `forceCodeSigning`, and its build result is used directly for publication.

**Tech Stack:** Electron, TypeScript, Electron Builder, macOS `codesign`, Vitest, Node test runner, GitHub Actions

---

### Task 1: Remove runtime sidecar integrity verification

**Files:**

- Modify: `apps/workspace/electron/src/sidecar.ts`
- Modify: `apps/workspace/electron/src/paths.ts`
- Modify: `apps/workspace/electron/src/sidecar.test.ts`
- Delete: `apps/workspace/electron/src/sidecar-integrity.ts`
- Delete: `apps/workspace/electron/src/sidecar-integrity.test.ts`

**Steps:**

1. Update the lifecycle test so sidecar startup succeeds without an integrity manifest.
2. Remove manifest reads and digest/signature verification from `startServerSidecar`.
3. Remove integrity-only path helpers and mocks.
4. Retain the existing file-existence, token, environment isolation, retry, and shutdown behavior.
5. Run `pnpm --dir apps/workspace exec vitest run electron/src/sidecar.test.ts` and expect all tests to pass.

### Task 2: Remove integrity manifest staging and packaging

**Files:**

- Modify: `apps/workspace/scripts/stage-electron.ts`
- Modify: `apps/workspace/scripts/stage-electron-app.ts`
- Delete: `apps/workspace/scripts/sidecar-integrity-manifest.ts`
- Delete: `apps/workspace/scripts/sidecar-integrity-manifest.test.ts`

**Steps:**

1. Remove SHA-256 manifest construction from sidecar staging.
2. Keep existence, executable permission, copy, and `chmod 755` checks for all sidecars.
3. Remove the manifest prerequisite, ASAR file entry, resource exclusion, and copy operation from app staging.
4. Compile Electron and stage an app fixture through the existing build scripts.

### Task 3: Remove redundant post-build macOS verification

**Files:**

- Delete: `.github/scripts/verify-macos-electron-release.ts`
- Modify: `.github/scripts/electron-release-scripts.test.ts`
- Modify: `.github/workflows/electron-release.yml`

**Steps:**

1. Delete the standalone post-build verification script.
2. Remove its workflow step and focused tests.
3. Continue relying on Electron Builder's `forceCodeSigning` and build exit status for signed macOS releases.
4. Run `node --test .github/scripts/*.test.ts` and expect all remaining tests to pass.

### Task 4: Document and validate the simplified trust boundary

**Files:**

- Modify: `docs/prompt-pack-runtime-policies.md`

**Steps:**

1. Document that macOS signing is performed by Electron Builder with `forceCodeSigning`.
2. Document that Windows is currently unsigned and has no custom runtime digest check.
3. Run workspace tests, Electron compilation, workspace build, Actions script tests and type checking, lint, formatting, and `git diff --check`.
