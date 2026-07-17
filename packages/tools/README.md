# tools

Engineering-class atomic capabilities for MediaGo Drama.

There are currently no enabled deterministic processing packages in this module. The previous text/video indexing backends were removed; related studio entries are frontend-only coming soon placeholders.

## Quick start

```bash
go mod tidy
task check
task test
```

## Layout

```text
doc.go                 # placeholder package; no enabled processing backends
go.mod                 # module declaration
Taskfile.yml           # go-task tasks (fmt / vet / test / tidy / check)
LICENSE                # Apache-2.0
```

## License

Apache-2.0 — see [LICENSE](LICENSE).
