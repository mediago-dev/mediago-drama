# vendor

Prepares native ACP agent binaries and external media tools for MediaGo Drama.

The stable ACP agent output contract is:

```text
dist/<agent-id>/
  agent.json
  <agent binary>
```

`agent.json` stores relative launch metadata. The server joins it with the
runtime agent bin directory so development and packaged desktop resource paths can differ.

## Usage

```bash
task prepare AGENT=codex
task prepare AGENT=opencode
task prepare:tool TOOL=ffmpeg
task prepare:tool TOOL=ffprobe
task prepare:tool TOOL=dreamina
task prepare:tool TOOL=libtv
task prepare:tool TOOL=pippit
task prepare:media-tools
task prepare:generation-clis GENERATION_CLIS=dreamina,libtv,pippit
task prepare:all
task prepare:clean
```

Supported agents and pinned versions are defined in `agents.json`. The Go
prepare command under `cmd/prepare-agent` downloads the matching GitHub release
asset for the current OS and architecture, extracts the native binary, and
writes the manifest consumed by `services/server`.

If `dist/<agent-id>/agent.json` already matches the pinned version, binary name,
args, and executable file, prepare reuses the cached artifact and skips the
download.

Vendored tools such as `ffmpeg`, `ffprobe`, and generation CLIs are defined in
`tools.json` and prepared under:

```text
dist/tools/<tool-id>/
  tool.json
  <tool binary>
```

Tool entries store pinned release URLs instead of committing native binaries.
When `sizeBytes` or `sha256` are present for a platform, they are checked before
installation. Tools can be distributed as raw executables or archives; archived
tools declare `archivePath` for the binary to extract.

`prepare:media-tools` always prepares the baseline media tools (`ffmpeg` and
`ffprobe`). `prepare:generation-clis` prepares the optional generation CLIs
selected for a build:

```bash
task prepare:generation-clis GENERATION_CLIS=dreamina
task prepare:generation-clis GENERATION_CLIS=dreamina,libtv,pippit
task prepare:generation-clis GENERATION_CLIS=dreamina,libtv,xiaoyunque
task prepare:generation-clis GENERATION_CLIS=none
```

`xiaoyunque` and `pippit-tool-cli` are accepted as aliases for the packaged
`pippit` tool.

## Checks

The module remains in `go.work` for workspace consistency, so the Go-oriented
check tasks stay available:

```bash
task check
task test
```
