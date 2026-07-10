# Official Codex ACP Migration Design

## Goal

Replace the legacy Rust `zed-industries/codex-acp` binary with the maintained
`@agentclientprotocol/codex-acp` adapter while keeping the packaged desktop app
fully offline and independent of a user-installed Node.js runtime.

## Architecture

The vendor preparation step downloads the pinned npm adapter archive, compiles
its published JavaScript entry point into a standalone executable with a pinned
Bun version, and downloads the matching platform build of `@openai/codex`.
The staged agent directory contains both executables and the Codex support tools.

`agent.json` records the adapter version, Codex version, and the relative Codex
executable path. The server resolves that path inside the selected vendored
agent directory and injects it as `CODEX_PATH` whenever it starts Codex ACP.
Existing `CODEX_HOME`, relay provider configuration, and ACP stdio transport stay
unchanged. When the prepared environment contains `CODEX_API_KEY` or
`OPENAI_API_KEY`, the server also sets an API-key `DEFAULT_AUTH_REQUEST` so the
new adapter authenticates before `session/new`; otherwise interactive ChatGPT
authentication remains available.

## Distribution layout

```text
dist/<platform>/codex/
  agent.json
  codex-acp[.exe]
  codex/
    vendor/<target>/bin/codex[.exe]
    vendor/<target>/bin/codex-code-mode-host[.exe]
    vendor/<target>/codex-path/rg[.exe]
```

## Safety and compatibility

- Versions for the adapter, Codex, and Bun are pinned in `agents.json`.
- npm tarball URLs are resolved from registry metadata rather than executing
  package lifecycle scripts.
- Archive extraction retains traversal protection.
- Manifest paths must remain relative to the agent directory.
- The existing Go ACP client remains in place and is verified against the new
  adapter with initialization and session configuration probes.
- The legacy GitHub release preparation path remains available for OpenCode.
