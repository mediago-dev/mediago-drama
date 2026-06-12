# server

HTTP server and stdio MCP entrypoints for the MediaGo Drama workspace.

Multimodal provider integrations live in
`github.com/torchstellar-team/mediago-drama/packages/core`; server code should
import `core` when they need those capabilities.

## Quick start

```bash
go mod tidy
task check
task test
go run ./cmd/mediago-server --config configs/server.yaml
```

The server exports `ONE_INTERNAL_API_URL` and `ONE_INTERNAL_API_TOKEN` for
child processes. External stdio MCP clients can use:

```bash
go run ./cmd/mediago-mcp --config configs/server.yaml
go run ./cmd/mediago-document-mcp --config configs/server.yaml --project <id>
```

## Layout

```text
cmd/mediago-server/      # HTTP server entrypoint
cmd/mediago-mcp/         # workspace MCP stdio entrypoint
cmd/mediago-document-mcp/ # document MCP stdio entrypoint
internal/app/          # embedded workspace HTTP server assembly
internal/domain/       # domain records and markdown document helpers
internal/repository/   # persistence boundary, being extracted from app
internal/service/      # business workflow boundary, being extracted from app
internal/http/         # HTTP handler/middleware boundary, being extracted from app
internal/workspace/    # workspace embed layer
configs/server.yaml    # example YAML config
go.mod                 # module declaration
Taskfile.yml           # go-task tasks (fmt / vet / test / tidy / check)
LICENSE                # MIT
```

`internal/workspace/dist` is a generated, ignored directory. Run the root
`pnpm build` script to build the React workspace, sync dist into the server module,
and compile the binary with the `workspace_dist` build tag.

## License

MIT — see [LICENSE](LICENSE).
