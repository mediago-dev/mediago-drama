# macOS Code Signing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make official macOS Electron releases fail closed unless they are signed with the MediaGo Developer ID certificate and notarized by Apple.

**Architecture:** Keep credentials exclusively in the protected `official-release` GitHub Environment. The release workflow validates the five repository-specific secrets, maps them to the environment variables understood by electron-builder, and enables the signing/notarization switches already consumed by `stage-electron-app.ts`.

**Tech Stack:** GitHub Actions, electron-builder, Apple Developer ID signing, Apple notarization.

---

### Task 1: Wire protected macOS signing credentials

**Files:**

- Modify: `.github/workflows/electron-release.yml`

**Step 1: Add a macOS-only credential preflight**

Add a build step that runs only for `darwin-arm64`, receives the five `MEDIAGO_*` GitHub Environment secrets, and exits with a clear error listing only missing secret names. Never print secret values.

**Step 2: Enable signing and notarization for the macOS matrix entry**

Set `MEDIAGO_MAC_SIGN=1` and `MEDIAGO_MAC_NOTARIZE=1` only for `darwin-arm64`. Map the repository-specific secrets to electron-builder's `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` variables.

**Step 3: Allow certificate identity discovery in the signed macOS build**

Override `CSC_IDENTITY_AUTO_DISCOVERY` to `true` for `darwin-arm64` while retaining `false` for other matrix entries.

### Task 2: Document provisioning and verification

**Files:**

- Modify: `docs/prompt-pack-runtime-policies.md`

**Step 1: Document the expected certificate and GitHub Environment secrets**

State that `MEDIAGO_MAC_CSC_LINK` contains a base64-encoded `.p12` exported with its private key from a `Developer ID Application` identity. Keep the existing secret names as the repository contract.

**Step 2: Document release verification commands**

Add `codesign`, `spctl`, and `xcrun stapler` checks for the unpacked `.app`, including the expected signed/notarized outcomes.

### Task 3: Validate locally without credentials

**Files:**

- Verify: `.github/workflows/electron-release.yml`
- Verify: `docs/prompt-pack-runtime-policies.md`

**Step 1: Parse the workflow as YAML**

Run a local YAML parser against `.github/workflows/electron-release.yml` and expect a successful parse.

**Step 2: Run formatting checks**

Run the repository's relevant formatting check and expect it to exit zero.

**Step 3: Inspect the final diff for secret safety**

Verify that no certificate, password, Apple ID, or Team ID value has been added to tracked files and that the workflow only references GitHub Environment secrets.

**Step 4: Perform the external release check after provisioning**

After the user adds the five secrets to `official-release`, dispatch the release workflow from `main`. Download the macOS artifact and verify its signature, Gatekeeper assessment, notarization ticket, application icon, and notification click behavior.
