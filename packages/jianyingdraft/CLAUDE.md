# go-lib — Agent Guide

Publishable Go library. Stack: **Go module + go-task + stdlib `testing`**.
Project layout follows
[golang-standards/project-layout](https://github.com/golang-standards/project-layout).

## Starter layout (what's actually on disk)

```
pkg/
└── greeter/                 # placeholder public package — rename / replace
    ├── greeter.go
    └── greeter_test.go

go.mod                       # module path = github.com/example/<name> — change before publishing
Taskfile.yml                 # fmt / vet / test / tidy / check
README.md
LICENSE                      # Apache-2.0
```

The starter is intentionally minimal. The rest of the standard layout
is **not** scaffolded — create directories only when you have real
content to put in them. The cheatsheet below tells you which directory
to use.

## golang-standards/project-layout — directory cheatsheet

Look up before creating a new top-level directory. Don't invent new ones.

| Dir | Purpose | When to create |
|-----|---------|----------------|
| `/pkg` | **Public** library code. Anything importable by consumers. API == contract. | Already exists. Add a new subpackage `pkg/<feature>/` when grouping is needed. |
| `/internal` | **Private** code. Go toolchain forbids imports from outside the module. | When you have helpers that must NOT leak to consumers (parsing internals, vendored utilities, version constants). |
| `/cmd/<name>/` | Optional CLI(s) that ship alongside the library. `main.go` here must stay thin — flag parsing, then call into `pkg/`. | Only if the library has a companion executable (e.g. a code generator, a smoke-test binary). Pure libraries don't need it. |
| `/examples/<name>/` | Runnable usage examples. Each subdir is `package main` with its own `main.go`. | When a public API is non-trivial; one example per major use case. |
| `/api/` | Protocol contracts: OpenAPI, Proto, JSON Schema, gRPC IDL. | If the library publishes a wire protocol or codegen source. |
| `/test/` | Integration / E2E tests + large test data. Unit tests stay next to source. | When you need a real backend (DB, network) or fixtures big enough to clutter source dirs. Gate with `//go:build integration`. |
| `/docs/` | Design docs, ADRs, architecture notes. | When you accumulate enough non-README prose to justify a directory. |
| `/scripts/` | Build, release, codegen, lint scripts. Treat as executable docs. | When something runs more than twice. |
| `/build/` | Packaging configs (CI, Dockerfiles for release builds, goreleaser config). | When you ship binaries from `/cmd` or want reproducible release packaging. |
| `/githooks/` | Repo-local git hooks. | If hooks are project-specific and not enforced by a separate tool. |
| `/tools/` | Dev tooling pinned via `tools.go` blank imports. | When you need versioned dev tools (mockgen, stringer). |
| `/third_party/` | Vendored / forked external code. | Rarely. Prefer `go.mod` replace directives. |

**Directories that signal "this stopped being a library":** `/configs`,
`/deployments`, `/web`, `/init`, `/assets`. If you find yourself
reaching for these, the project is becoming an application — reconsider
the scope or split into two modules.

## Library contract — these are the rules

A library is a public API. Every exported symbol is a promise.

- **Only `pkg/**` is public.** Anything you don't want consumers to
  import goes under `internal/`. Renaming, removing, or changing the
  signature of an exported symbol in `pkg/` is a **breaking change**.
- **Semantic versioning is non-negotiable.** Breaking changes bump
  major. New features bump minor. Bugfixes bump patch.
- **`v2+` requires a module path bump.** Append `/v2` (or `/v3`...) to
  the module path in `go.mod` AND in import paths. There is no
  shortcut.
- **Every exported symbol has a doc comment** that starts with the
  identifier name. `// Greet returns ...`, not `// Returns ...`.
- **No `init()` side effects.** Consumers may not want them. Use
  explicit constructors.
- **Don't pollute global state.** No global mutable variables, no
  hidden defaults that consumers can't override.
- **Be conservative with dependencies.** Every dependency you add is
  one your consumers must download and audit. Prefer the stdlib.
  Vet bundle-size impact before pulling in anything heavy.
- **Don't ship binaries from the root.** If you need a CLI, put it
  under `cmd/<name>/`.

## Engineering discipline — mandatory

1. `task check` exits 0 (tidy + fmt + vet + test)
2. `go test -race ./...` passes — every new exported symbol comes
   with a test
3. `go build ./...` compiles
4. Stage explicitly: `git add <file>`. Never `git add -A`.
5. Conventional commit messages: `feat(greeter): add multi-language Greet variants`.
6. For breaking changes use `feat!:` or `fix!:` prefix AND describe
   the breakage in the commit body.

If any check fails, stop. Fix the root cause; don't paper over.

## Testing conventions

- **Unit tests live next to source** as `<name>_test.go`. `go test`
  auto-discovers them.
- **Table-driven tests** for cases with shared setup. Use `t.Run(tt.name, ...)`
  for sub-tests so failures point at the specific case.
- **Test the public API**, not internal helpers. If a helper is
  important enough to test directly, ask whether it should be in
  `pkg/` after all.
- **No mocks for pure functions.** When impurity is unavoidable,
  inject collaborators via interfaces. Define the interface in the
  **consumer** package — not the producer (Go interface segregation).
- **Race detector is mandatory.** `go test -race ./...` is part of
  `task test`. Don't disable it.
- **Integration tests** go under `/test/` with `//go:build integration`
  build tag, run via `go test -tags=integration ./test/...`.
- **Examples are tests too.** `func ExampleGreet()` in `pkg/greeter/`
  compiles, runs, and verifies `// Output:` lines. Use them for the
  most-used API surfaces.

## Code style

- ❌ **`interface{}` / `any`** unless you genuinely accept any type.
  Prefer generics (`func F[T any](...)`) or concrete types.
- ❌ **`(value, bool)` for "not found"** — use `(value, error)` with a
  sentinel error and `errors.Is(err, ErrNotFound)`. Bool returns
  don't compose with `errors.Wrap`.
- ❌ **`panic` outside `init()` or `main`.** Libraries return errors.
  A panic crashes the consumer.
- ❌ **`log.Print*` / `fmt.Println` for diagnostics.** Libraries don't
  own the logger. Accept one via constructor (`*slog.Logger` or an
  interface), or return errors and let the consumer log.
- ❌ **Reading env vars in library code.** Take values as parameters;
  let the consumer decide where they come from.
- ✅ **`context.Context` as the first parameter** for any function
  that may block, do I/O, or be cancellable.
- ✅ **Wrap errors with context**: `fmt.Errorf("decoding payload: %w", err)`.
  Use `%w` for the cause, `%v` for non-wrapping formatting.
- ✅ **Sentinel errors for branchable cases**: `var ErrNotFound = errors.New("...")`.
- ✅ **Doc comments on every exported symbol**, starting with the
  identifier name.

## Adding a new public API — checklist

1. Implement in `pkg/<feature>/<feature>.go` with a doc comment.
2. Add table-driven tests in `pkg/<feature>/<feature>_test.go` (happy
   path + each error case + boundary inputs).
3. If the API benefits from a worked example, add
   `func ExampleX()` in the same package — the godoc renders it.
4. If non-trivial, add a runnable example under `examples/<feature>/main.go`.
5. Run `task check` — must be green.
6. Commit. Conventional message. If signature changes break consumers,
   use `feat!:` and call out the breakage explicitly.

## Adding a new internal helper

1. Pick the right home:
   - Reusable across `pkg/` subpackages but not for consumers →
     `internal/<helper>/`
   - Specific to one `pkg/` subpackage → `pkg/<feature>/<helper>.go`
     (unexported) or `pkg/<feature>/internal/<helper>/`
2. Tests next to source, same package.
3. Never export from `internal/`. If you find yourself wanting to,
   move the symbol to `pkg/`.

## Versioning workflow

```bash
# 1. Make the change + commit.
# 2. Tag the release.
git tag v0.1.0
git push origin v0.1.0
# 3. For major bumps, update module path FIRST:
#    go.mod:   module github.com/example/<name>/v2
#    imports:  github.com/example/<name>/v2/pkg/...
#    then tag v2.0.0
```

## Quality gates

```bash
task check          # tidy + fmt + vet + test
task test:cover     # coverage report (look at -func output)
go build ./...      # compiles cleanly
```

All must pass before declaring a change complete.

## References

- [golang-standards/project-layout](https://github.com/golang-standards/project-layout)
- [Effective Go](https://go.dev/doc/effective_go)
- [Go Code Review Comments](https://go.dev/wiki/CodeReviewComments)
- [Module version numbering](https://go.dev/doc/modules/version-numbers)
