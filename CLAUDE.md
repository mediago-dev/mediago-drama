<!-- one ai-guides:start -->
# Claude Code 工作区 AI 指南

本段内容由 One CLI 基于项目模板为 `CLAUDE.md` 自动生成。请优先修改模板 AI 片段，或通过 `one add` 刷新；不要直接手改这段受管内容。

## 工作区

- 根目录：当前包含 `one.manifest.json` 的工作区目录
- AI 提供方：`claude-code`
- 模板分组数：3

## custom

适用项目：
- `packages/core`
- `packages/instructions`
- `packages/mcp`
- `packages/tools`

### 内置指引
- 当前模板 `custom` 没有内置 AI 最佳实践片段。
- 先阅读该项目的 README、package.json、脚本和样式/运行时入口，再开始修改。
- 优先保持现有技术栈和目录约定，不要臆造新的工程层级。

## go-api

适用项目：
- `services/server`

# go-api — Agent Guide

Go HTTP API service. Stack: **Go + Gin + Gorm + Viper + Zap + go-task**.

## Project layout

```
cmd/server/                 # executable entrypoint (main.go)
internal/
├── app/                    # application wiring (DI / startup)
├── http/
│   ├── handlers/           # Gin handler funcs — HTTP I/O only
│   ├── middleware/         # logger, request_id, metrics
│   └── response/           # consistent JSON response shape
├── domain/                 # domain models (User, etc.)
├── repository/             # Gorm repositories — the ONLY DB layer
├── service/                # business services
├── platform/
│   ├── jwt/                # JWT signing / parsing
│   └── logger/             # zap logger setup
└── config/                 # Viper config loader
api/                        # OpenAPI spec
configs/                    # config.yaml + .env.example
migrations/                 # SQL migrations
scripts/                    # ops scripts
Taskfile.yml                # go-task tasks
```

## Architecture boundaries — NEVER violate

- **Handler** (`internal/http/handlers/`): bind request → call service → write response. Thin. No business logic. No DB access. No SQL.
- **Service** (`internal/service/`): business logic. Stateless. Take dependencies via constructor.
- **Repository** (`internal/repository/`): the ONLY layer that touches Gorm / SQL. Returns domain models, not Gorm structs.
- **Domain** (`internal/domain/`): pure structs and methods. No imports of Gin / Gorm / Viper.
- **Cross-cutting** (auth, logging, request ID, metrics) → middleware in `internal/http/middleware/`.

## Pre-wired infrastructure — DO use, DON'T recreate

| Need | Where |
|------|-------|
| Config (env + yaml) | `internal/config` (Viper-backed). Inject `*config.Config` into constructors. |
| Logger | `internal/platform/logger` (Zap). Pass `*zap.Logger` via constructor — never use `log.Print*`. |
| JWT | `internal/platform/jwt` |
| Request ID | `middleware.RequestID` — already wired in `internal/app` |
| Structured response | `internal/http/response` (success / error / list helpers) |
| DB | Gorm via `repository/`; configure in `internal/app` |
| API docs | `api/openapi.yaml` feeds Swagger UI at `/api/docs`; keep it in sync with routes and response shapes. |

## Engineering discipline — mandatory

1. `task check` (gofmt + vet + golangci-lint) exits 0
2. `task test` passes — new code must come with tests
3. `go build ./...` compiles
4. Stage explicitly: `git add <file>`. Never `git add -A`.
5. Conventional commit messages: `feat(user): add password reset endpoint`.
6. Never commit secrets. Use `one secrets set <KEY> --env <env>`.

If any fails, stop. Fix the root cause, don't paper over.

## Testing conventions

- Unit tests: `<name>_test.go` next to source. Standard Go testing package.
- Use **table-driven tests** for cases with shared setup.
- Mock external deps (DB, HTTP) at the interface boundary — define interfaces in the consumer package, not the producer.
- Repository tests: use a real DB in CI (Docker), mock interfaces in service tests.
- `go test -race ./...` must pass.

## Code style

- ❌ Don't use `interface{}` / `any` unless necessary. Use generics or a concrete type.
- ❌ Don't return `(value, bool)` for "not found" — use `(value, error)` with `errors.Is(err, ErrNotFound)`.
- ❌ Don't use `panic` outside `init()` / `main`. Return errors.
- ❌ Don't `log.Print*`. Inject `*zap.Logger`.
- ❌ Don't read `os.Getenv` in business code. Read via `*config.Config`.
- ✅ Every exported func / type has a doc comment starting with the identifier.
- ✅ Wrap errors with context: `fmt.Errorf("loading user %d: %w", id, err)`.
- ✅ Use `context.Context` as the first parameter for any operation that may block / be cancelled.

## Common patterns

**Add a new endpoint**

1. Define request DTO in `internal/http/handlers/<feature>.go` (struct with `binding` tags).
2. Add validation: `c.ShouldBindJSON(&req)` → returns 400 on failure.
3. Call the service: `svc.DoThing(c.Request.Context(), req)`.
4. Write response via `response.OK(c, data)` or `response.Error(c, err)`.
5. Register route in `internal/http/router.go`.
6. Add unit test for the handler (mock the service interface).
7. Add OpenAPI doc in `api/openapi.yaml` and verify it renders in Swagger UI at `/api/docs`.

**Add a new repository method**

1. Define interface method in `internal/repository/<feature>_repo.go`.
2. Implement against Gorm. Convert Gorm struct → domain model before returning.
3. Update the service that consumes it.
4. Add migration in `migrations/` if schema changes.

**Add config**

1. Add field to `internal/config/config.go` struct (with `mapstructure` tag).
2. Add default in `configs/config.yaml`.
3. Document env var override in `.env.example`.

## Quality gates

```bash
task check         # gofmt + vet + lint
task test          # go test -race ./...
task build         # go build -o bin/server ./cmd/server
```

All must pass before declaring a change complete.

## react-spa

适用项目：
- `apps/app`
- `apps/workspace`

# react-spa — Agent Guide

CSR (client-side rendered) React app. Stack: **React 19 + Vite + TypeScript + shadcn/ui + Tailwind CSS v4 + SWR + Zustand + sonner**.

The homepage at `src/pages/Home.tsx` is intentionally minimal (Vue/React-scaffold style). Don't bring back demo galleries — extend by composing the pre-wired infrastructure below.

## Project layout

```
src/
├── App.tsx              # Shell (header + routes + footer). Theme toggle lives here.
├── main.tsx             # Mount point + providers wiring
├── api/                 # Pure functions, "key + fetcher" shape (api/demo.ts is the canonical example)
├── components/
│   ├── ui/              # shadcn primitives — atoms (Button, Card, Badge, Input, Alert, Label)
│   └── ErrorBoundary.tsx # Wraps the router, catches render errors
├── hooks/               # Custom hooks (useToast)
├── lib/
│   ├── stores/          # Zustand slices (theme, toast)
│   ├── http.ts          # Axios instance — use as SWR fetcher
│   ├── toast.ts         # Sonner-backed toast singleton
│   ├── app-info.ts      # Read VITE_* env vars
│   └── utils.ts         # cn() classname merger
├── pages/               # Route-level components (Home.tsx is "/")
├── providers/           # SWRProvider, ThemeProvider
├── router/routes.tsx    # react-router-dom route table
└── styles/
    ├── tokens.css       # Design tokens — CSS variables, light + dark
    ├── tailwind.css     # Tailwind v4 entry
    ├── index.css        # Global styles entry
    └── reset.css
```

## Pre-wired infrastructure — DO import, DON'T recreate

| Need | Import |
|------|--------|
| Theme toggle | `useThemeStore` from `@/lib/stores/theme` (returns `{ mode, toggle, setMode }`) |
| Toast notifications | `useToast` from `@/hooks/useToast` — `toast.success / .info / .warning / .error` |
| HTTP client | default export from `@/lib/http` (axios) |
| Data fetching | `useSWR(key, fetcher)` — pair with `@/lib/http` |
| Error boundary | already wraps the router (`@/components/ErrorBoundary`) |
| Class merging | `cn()` from `@/lib/utils` |
| App metadata | `appInfo`, `getEnvironmentLabel` from `@/lib/app-info` |

## Atomic design (advisory — physical folders NOT enforced)

| Layer | Where | Examples |
|-------|-------|----------|
| atoms | `src/components/ui/` | Button, Card, Badge, Input |
| molecules | `src/components/` | Compose atoms — e.g. a SearchInput = Input + Button |
| organisms | `src/components/sections/` (create when needed) | Page-level blocks like NavBar |
| pages | `src/pages/` | Route-level components |

Don't dump unrelated logic in atoms. Don't import organisms from atoms (one-way dependency: atoms ← molecules ← organisms ← pages).

## Design tokens — use Tailwind utilities, never hex/rgb

Tokens live in `src/styles/tokens.css` as CSS variables (light + dark themes). The Tailwind classes below map to these variables — use them so theme switching just works.

| Concern | Use these classes |
|---------|-------------------|
| Surface | `bg-background`, `bg-card`, `bg-popover`, `bg-muted` |
| Text | `text-foreground`, `text-muted-foreground`, `text-primary` |
| Border | `border-border`, `border-input` |
| Accent | `bg-primary`, `bg-secondary`, `bg-destructive` |
| Semantic | `bg-success-surface` / `bg-info-surface` / `bg-warning-surface` / `bg-error-surface` (and matching `border-*` / `text-*-foreground`) |

❌ DON'T write `bg-[#ff0000]`, `text-blue-600`, or any hex/rgb. If you need a new color, add a CSS variable to `tokens.css` first.

## Common patterns

**Counter / stateful slice**

```ts
// src/lib/stores/counter.ts
import { createStore } from "@/lib/utils";
export const useCounterStore = createStore<{ count: number; inc: () => void }>(
  (set) => ({ count: 0, inc: () => set((s) => ({ count: s.count + 1 })) }),
  "counter",
);
```

**SWR data fetch**

```tsx
import useSWR from "swr";
import { demoKey, getDemo } from "@/api/demo";
const { data, error, isLoading, mutate } = useSWR(demoKey, getDemo);
```

**Toast notifications**

```tsx
const toast = useToast();
toast.success("Saved", { description: "Draft updated" });
toast.error("Failed", { description: err.message });
```

**Throw to ErrorBoundary**

```tsx
if (somethingWrong) throw new Error("...");  // Caught by ErrorBoundary, shows fallback UI
```

## Quality gates

```bash
pnpm lint          # oxlint
pnpm format        # oxfmt --check
pnpm build         # tsc -b && vite build  (runs typecheck)
```

All three must pass before declaring a change complete.

<!-- one ai-guides:end -->
