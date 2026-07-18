# Electron Automatic Versioning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Electron Release workflow calculate the next SemVer from Git tags using channel and bump dropdowns.

**Architecture:** Keep GitHub Actions responsible for collecting inputs and fetching tags. Put SemVer parsing and increment rules in a dependency-free Node module so the behavior can be exercised with `node:test` before the workflow consumes its outputs.

**Tech Stack:** GitHub Actions, Node.js 24, ECMAScript modules, `node:test`, Git tags.

---

### Task 1: Add the version resolver tests

**Files:**

- Create: `.github/scripts/resolve-electron-release-version.test.ts`
- Create: `.github/scripts/resolve-electron-release-version.ts`

1. Cover patch, minor, and major stable increments.
2. Cover continuation of an existing alpha or beta sequence.
3. Cover starting a prerelease after a stable version and switching prerelease channels.
4. Cover invalid inputs and malformed tags.
5. Run `node --test .github/scripts/resolve-electron-release-version.test.ts` and expect all cases to pass.

### Task 2: Update the workflow inputs and version job

**Files:**

- Modify: `.github/workflows/electron-release.yml`

1. Remove the manual base version and prerelease number inputs.
2. Add a `bump` choice with `patch`, `minor`, and `major` values.
3. Fetch the complete tag history in the release-version job.
4. Call the resolver and expose its GitHub output fields to downstream jobs.
5. Update the concurrency key to use channel and bump.

### Task 3: Verify the release workflow

**Files:**

- Test: `.github/scripts/resolve-electron-release-version.test.ts`
- Test: `.github/workflows/electron-release.yml`

1. Run the resolver test suite.
2. Run formatting and lint checks for the new JavaScript files.
3. Parse the workflow as YAML.
4. Run `git diff --check`.

### Task 4: Move release workflow logic to TypeScript

**Files:**

- Rename: `.github/scripts/resolve-electron-release-version.mjs` to `.github/scripts/resolve-electron-release-version.ts`
- Rename: `.github/scripts/resolve-electron-release-version.test.mjs` to `.github/scripts/resolve-electron-release-version.test.ts`
- Create: `.github/scripts/apply-electron-release-version.ts`
- Create: `.github/scripts/validate-electron-release-env.ts`
- Create: `.github/scripts/verify-macos-electron-release.ts`
- Create: `.github/scripts/publish-electron-release.ts`
- Modify: `.github/workflows/electron-release.yml`

1. Use Node 24's native TypeScript type stripping so Actions needs no extra runtime dependency.
2. Replace long inline version mutation, credential validation, macOS verification, and release publication blocks with one-line TypeScript invocations.
3. Keep short build commands and ref authorization checks inline where a separate script would add indirection without meaningful testability.
4. Unit test pure version resolution, JSON mutation, environment validation, fuse validation, and release artifact selection.
5. Run `node --test .github/scripts/*.test.ts` and expect all tests to pass.
