# vendor

Prepares the pinned native Codex CLI and external media tools for MediaGo Drama OSS.

```text
dist/codex/
  agent.json
  runtime/bin/codex[.exe]
  runtime/...               # platform helpers and resources
```

The server launches the native binary as `codex app-server --listen stdio://`.
`agents.json` pins `@openai/codex` to 0.163.0, matching the checked app-server protocol.
Preparation installs the official platform npm archive directly; packaged users need no Node.js runtime.
`agent.json` contains relative native executable paths. Matching complete caches are reused.

```bash
one exec -p vendor -- task prepare
one exec -p vendor -- task prepare PLATFORM=windows-x64
one exec -p vendor -- task prepare:media-tools
one exec -p vendor -- task prepare:generation-clis GENERATION_CLIS=dreamina,libtv
one exec -p vendor -- task prepare:all
```

Vendored tools such as `ffmpeg`, `ffprobe`, and generation CLIs are defined in
`tools.json` and prepared under:

```text
dist/tools/<tool-id>/
  tool.json
  <tool binary>
```

Dreamina CLI is pinned to 1.4.21; each official platform binary is verified by size and SHA-256.
Tool entries store release URLs instead of committing native binaries.
When `sizeBytes` or `sha256` are present for a platform, they are checked before
installation. Tools can be distributed as raw executables or archives; archived
tools declare `archivePath` for the binary to extract.

## Checks

The module remains in `go.work` for workspace consistency, so the Go-oriented
check tasks stay available:

```bash
task check
task test
```
