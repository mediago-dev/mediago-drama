# vendor

Prepares native ACP agent binaries and external media tools for MediaGo Drama.

The stable ACP agent output contract is:

```text
dist/<agent-id>/
  agent.json
  <agent binary>
```

`agent.json` stores relative launch metadata. The server joins it with the
runtime agent bin directory so development and Tauri resource paths can differ.

## Usage

```bash
task prepare AGENT=codex
task prepare AGENT=opencode
task prepare:tool TOOL=ffmpeg
task prepare:tool TOOL=ffprobe
task prepare:media-tools
task prepare:all
task prepare:clean
```

Supported agents and pinned versions are defined in `agents.json`. The Go
prepare command under `cmd/prepare-agent` downloads the matching GitHub release
asset for the current OS and architecture, extracts the native binary, and
writes the manifest consumed by `packages/server`.

If `dist/<agent-id>/agent.json` already matches the pinned version, binary name,
args, and executable file, prepare reuses the cached artifact and skips the
download.

Vendored tools such as `ffmpeg` and `ffprobe` are defined in `tools.json` and
prepared under:

```text
dist/tools/<tool-id>/
  tool.json
  <tool binary>
```

Tool entries store pinned release URLs and expected sizes instead of committing
native binaries. `sha256` is supported per platform and verified when present;
for third-party releases that do not publish checksums, the fixed release URL
and asset size are still checked before installation.

## Checks

The module remains in `go.work` for workspace consistency, so the Go-oriented
check tasks stay available:

```bash
task check
task test
```
