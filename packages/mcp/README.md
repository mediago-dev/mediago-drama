# MediaGo Drama MCP

Shared MCP protocol and server assembly helpers for MediaGo Drama. The package
follows the `golang-standards/project-layout` convention by exposing reusable
code from `pkg/mcp` and `pkg/server`; private tool implementation packages live
under `internal/`.

## Quick start

```bash
go mod tidy
task check
task test
```

## Layout

```text
internal/
├── envconfig/         # env -> server config helpers
├── httpx/             # private HTTP assembly helpers
└── tools/             # private tool implementation packages
pkg/
├── mcp/               # protocol records, transport helpers, tool metadata
└── server/            # public server factories and dependency interfaces
go.mod
Taskfile.yml
```

The document MCP executable entrypoint lives in
`packages/server/cmd/mediago-document-mcp`; this module stays focused on shared
protocol/runtime code.

## Use From CLI

```bash
go get github.com/mediago-dev/mediago-drama/packages/mcp
```

```go
import mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"

name := mediamcp.ToolName("load_skill")
```

## Protocol Boundary

Treat this package as the change review surface for MCP protocol changes.
Moving a JSON field, tool name, tool description, HTTP route/header, or
tool input/output record here is intentional: diffs in this package mean
the frontend/backend shared document-tool contract may need review.

Current run-scoped document MCP tools are `load_skill`, `list_comments`,
`get_comment`, and `mutate_comment`. The external cross-project server adds
`list_projects`. Run-scoped agents are started with the project `work`
directory as their current working directory, so project documents are read and
edited directly as Markdown files under `.`. Full usage guidance is returned in
the MCP server `instructions` field during initialize and repeated briefly in
tool descriptions.

## License

MIT — see [LICENSE](LICENSE).
