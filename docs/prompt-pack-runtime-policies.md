# Local prompt packs and OSS packaging

The OSS server directly imports ordinary v1 `.mgpack` files. There is no
marketplace/partner build policy, online entitlement check, private importer,
or commercial Runtime dependency. Encrypted v2 containers return an explicit
unsupported-format error; they are never handed to another executable.

## Local workflow

Import a v1 pack, inspect its contents, copy it into a local authoring pack,
edit the copy, and export it as v1. Built-in packs and imported snapshots remain
read-only so upgrades and edits do not overwrite their source. Packs with legacy
release identities retain their existing snapshot management restrictions.

Re-importing identical content is idempotent. Conflicting content with an
existing ID is rejected rather than overwriting a local draft or installed pack.

## Historical data

Existing project, generation-task, token, prompt-pack, and source-provenance
columns remain in place. Starting the OSS server does not convert old installed
releases into authoring packs or rewrite their content. Already-installed packs
continue serving their saved local entries without a remote entitlement check.
Old price overlay YAML keys are ignored, and no price table is loaded.

Usage summaries expose calls and token counts at `/api/v1/usage/summary` and
`/api/v1/projects/{projectId}/usage/summary`. They read existing generation task
records, including retired providers, without storing or returning monetary data.

## Public build

The vendor tasks prepare Codex, ffmpeg, ffprobe, Dreamina, and LibTV from public
artifacts. Desktop builds do not download `mediago-drama-private` or require
`MEDIAGO_PRIVATE_ARTIFACT_TOKEN` or a rights release tag. There is no commercial
policy flag in the Go linker arguments or Electron resource selection.

macOS code signing and optional notarization remain release security features.
Official macOS CI verifies the signed application before uploading artifacts.
Local development builds do not require signing credentials.

The desktop starts the local server with a fresh sidecar token. Renderer API
requests must present it, and Agent subprocesses use a separate bridge token.
These local security boundaries and Agent approvals remain enabled.

TalkingData SDK loading, route tracking, and generation-event tracking have been
removed from both browser and desktop builds.
