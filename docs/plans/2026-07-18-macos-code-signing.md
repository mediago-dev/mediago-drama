# macOS Code Signing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make official macOS Electron releases fail closed unless they are signed with the MediaGo Developer ID certificate, while keeping Apple notarization opt-in.

**Architecture:** Keep credentials exclusively in the protected `official-release` GitHub Environment. The release workflow always validates the two signing secrets and enables the signing switch consumed by `stage-electron-app.ts`. Notarization and its three additional secrets are enabled only when the `MEDIAGO_MAC_NOTARIZE` environment variable is `1`.

**Tech Stack:** GitHub Actions, electron-builder, Apple Developer ID signing, Apple notarization.

---

### Task 1: Wire protected macOS signing credentials

**Files:**

- Modify: `.github/workflows/electron-release.yml`

**Step 1: Add a macOS-only credential preflight**

Add a build step that runs only for `darwin-arm64`, receives the two signing secrets, and exits with a clear error listing only missing secret names. Add a separate notarization preflight that runs only when `MEDIAGO_MAC_NOTARIZE=1`. Never print secret values.

**Step 2: Enable signing and make notarization opt-in for the macOS matrix entry**

Set `MEDIAGO_MAC_SIGN=1` for `darwin-arm64`. Set `MEDIAGO_MAC_NOTARIZE=1` and inject `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` only when the matching GitHub Environment variable is `1`.

**Step 3: Allow certificate identity discovery in the signed macOS build**

Override `CSC_IDENTITY_AUTO_DISCOVERY` to `true` for `darwin-arm64` while retaining `false` for other matrix entries.

### Task 2: Document provisioning and verification

**Files:**

- Modify: `docs/prompt-pack-runtime-policies.md`

**Step 1: Document the expected certificate and GitHub Environment secrets**

State that `MEDIAGO_MAC_CSC_LINK` contains a base64-encoded `.p12` exported with its private key from a `Developer ID Application` identity. Document the notarization opt-in variable and its additional secrets.

**Step 2: Document release verification commands**

Add `codesign` checks for every signed `.app`, with `spctl` and `xcrun stapler` checks only for notarized releases.

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

After the user adds the two signing secrets to `official-release`, dispatch the release workflow from `main`. Download the macOS artifact and verify its signature, application icon, and notification click behavior. When notarization is later enabled, also verify Gatekeeper assessment and the stapled ticket.
