# Codex Global Skills Read-only Inventory Implementation Plan

**Status:** Implemented on 2026-07-14. Automated gates and a real Go + Vite HTTP smoke test are complete; embedded-browser visual acceptance could not run because the installed browser plugin failed while connecting. This document is retained as the implementation and regression-test checklist.

**Goal:** Add a read-only settings page that inventories Codex global filesystem skills and diagnoses expected availability in normal Codex App/CLI and the MediaGo Codex runtime.

**Architecture:** Add a dedicated Go `codexskill` scanner instead of extending the prompt-pack Skill registry. The scanner reads only documented/compatible global roots, parses bounded metadata, compares host and MediaGo Codex homes/configs, and exposes list/detail endpoints consumed by a new React settings panel.

**Tech Stack:** Go 1.25, Gin, yaml.v3, pelletier/go-toml/v2, React 19, TypeScript, SWR, Tailwind CSS v4, Vitest, Testing Library.

---

### Task 1: Define and test bounded Codex Skill parsing

**Files:**

- Create: `services/server/internal/service/codexskill/types.go`
- Create: `services/server/internal/service/codexskill/parser.go`
- Create: `services/server/internal/service/codexskill/parser_test.go`

1. Write table-driven failing tests for valid `SKILL.md`, missing delimiters, invalid YAML, missing `name` fallback, missing `description`, oversized input, and optional `agents/openai.yaml` fields including `policy.products`.
2. Run `go test ./internal/service/codexskill -run TestParse -count=1` from `services/server` and confirm the package/tests fail before implementation.
3. Add exported enums and DTOs for source, syntax validity, surface availability, reason codes, dependencies, roots, issues and summary. Every exported identifier must have a doc comment.
4. Implement capped preview reads: 256 KiB for raw `SKILL.md`, 64 KiB for `agents/openai.yaml`. Oversized `SKILL.md` remains valid when its frontmatter is parseable, but its raw preview is omitted; optional metadata failures are fail-open.
5. Detect `scripts`, `references`, and `assets` by directory existence without reading their contents.
6. Re-run the targeted parser tests and confirm success.

### Task 2: Discover global roots, symlinks, config state and duplicates

**Files:**

- Create: `services/server/internal/service/codexskill/service.go`
- Create: `services/server/internal/service/codexskill/service_test.go`
- Modify: `services/server/go.mod`
- Modify: `services/server/go.sum`

1. Write failing tests using temporary Home/Codex Home directories for `$HOME/.agents/skills`, `$CODEX_HOME/skills`, Unix admin roots, `.system` children, missing roots and unreadable roots.
2. Add tests for recursive discovery bounded to depth 6 and per-root directory/entry limits; user/admin roots may follow directory symlinks while the system root does not.
3. Add tests proving canonicalized aliases to one physical `SKILL.md` are merged with their origins retained, while distinct canonical paths with the same name remain separate and report `sameNameCount = 2`.
4. Add tests for ordered `[[skills.config]]` rules using either an exact normalized `SKILL.md` file path or a name selector, last-match-wins behavior, invalid selector combinations, `[skills.bundled].enabled`, and malformed TOML becoming a source issue rather than a total failure.
5. Run `go test ./internal/service/codexskill -count=1` and confirm failure.
6. Implement injectable environment/home/root providers, stable IDs derived from canonical Skill identity, normalized path matching, partial-error aggregation, summaries and deterministic ordering.
7. Promote `github.com/pelletier/go-toml/v2` from indirect to direct use and run `go mod tidy` from `services/server`.
8. Re-run the package tests and confirm success, including under `-race`.

### Task 3: Expose a pure MediaGo Codex runtime-home descriptor

**Files:**

- Modify: `services/server/internal/service/settings/codex_relay.go`
- Modify: `services/server/internal/service/settings/codex_relay_test.go`

1. Add failing tests for a read-only runtime-home query when relay is absent, disabled, missing credentials and fully active.
2. Assert the query never creates the runtime directory and never writes `config.toml` or `auth.json`.
3. Run `go test ./internal/service/settings -run Test.*Codex.*RuntimeHome -count=1` and confirm failure.
4. Add a documented method that reuses the active relay predicate and returns an optional isolated Codex Home override under `.mediago-drama/runtime/agents/codex/home` without calling `PrepareCodexRelayRuntimeConfig`.
5. Re-run the targeted settings tests and confirm success.

### Task 4: Wire list/detail HTTP APIs without touching prompt-pack Skills

**Files:**

- Create: `services/server/internal/http/handlers/codex_skills.go`
- Create: `services/server/internal/http/handlers/codex_skills_test.go`
- Modify: `services/server/internal/http/routes/routes.go`
- Modify: `services/server/internal/app/api.go`
- Modify: `services/server/internal/app/wire.go`
- Modify: `services/server/internal/app/app.go`
- Modify: `services/server/internal/app/api_test.go`
- Modify: `services/server/cmd/mediago-server/main.go`

1. Write handler tests against a consumer-defined service interface for list success, detail success, unknown ID, fatal scan error and partial root errors returned in a successful payload.
2. Run `go test ./internal/http/handlers -run TestCodexSkills -count=1` and confirm failure.
3. Implement `GET /api/v1/codex-skills` and `GET /api/v1/codex-skills/:id`; do not add POST, PUT, PATCH or DELETE routes.
4. Generate the scanner in `wire.go`, injecting the resolved workspace directory and the pure runtime-home provider. Store it separately from `skillRegistry` on `apiHandler`.
5. Add Swagger annotations and the `Codex Skills` tag in the server entrypoint.
6. Add an app-level route test that checks both endpoints and confirms `/api/v1/skills` behavior remains unchanged.
7. Run the handler and app tests; run `task swagger` to verify documentation generation.

### Task 5: Add a typed frontend API client

**Files:**

- Create: `apps/workspace/src/domains/settings/api/codex-skills.ts`
- Create: `apps/workspace/src/domains/settings/api/codex-skills.test.ts`

1. Define TypeScript unions mirroring backend source and availability enums; keep `codexSkillsKey = "/codex-skills"` separate from the existing `skillsKey = "/skills"`.
2. Add failing client tests for list and encoded detail requests using the repository's HTTP mocking convention.
3. Implement `listCodexSkills()` and `getCodexSkill(id)` with the shared HTTP client.
4. Run the targeted Vitest file and confirm success.

### Task 6: Build the read-only inventory and diagnostic panel

**Files:**

- Create: `apps/workspace/src/domains/settings/components/CodexSkillsPanel.tsx`
- Create: `apps/workspace/src/domains/settings/components/CodexSkillsPanel.test.tsx`

1. Write failing component tests for loading, empty, fatal error, partial root error, summary counts, search, source/status filters, selected detail and manual refresh.
2. Add tests that `available`, `disabled`, `not_shared`, `invalid`, and `unknown` are communicated with visible text, not color alone.
3. Add tests for same-name warnings, keyboard-selectable rows, details loading/404 recovery, and the canonical `~/.agents/skills` guidance in the empty state.
4. Add desktop/browser tests: desktop shows “在文件管理器中显示” and calls `revealNativePath` with the detail-only absolute path; browser mode does not render the action.
5. Run `pnpm test -- src/domains/settings/components/CodexSkillsPanel.test.tsx` from `apps/workspace` and confirm failure.
6. Implement the panel with `SettingsPanelLayout`, SWR list/detail requests, compact summaries, labelled search/filter controls, a two-column responsive layout and existing token-based Tailwind classes only.
7. Display raw `SKILL.md` in a focusable plaintext `<pre>`/code surface. Do not use the Markdown preview component, render local icons, or auto-open links/assets.
8. Re-run the targeted component tests and confirm success.

### Task 7: Add the settings navigation entry

**Files:**

- Modify: `apps/workspace/src/pages/Settings.tsx`
- Modify: `apps/workspace/src/pages/Settings.test.tsx`
- Modify: `apps/workspace/src/lib/stores/settings.ts`
- Modify: `apps/workspace/src/domains/workspace/components/ProjectNavigatorPanels.tsx`
- Modify: `apps/workspace/src/domains/workspace/components/ProjectNavigatorPanels.test.tsx`

1. Add failing tests that select `codex-skills`, render `CodexSkillsPanel`, and keep the tab valid regardless of the active Agent backend.
2. Add a sidebar-order test expecting “Codex 技能” after “Codex 中转” for Codex and after “API 密钥” for other backends, before “智能体指令”.
3. Run the two targeted test files and confirm failure.
4. Add the tab value, icon, label and panel branch. Do not map the legacy `skills` alias to this page; keep that alias pointing to existing prompt packs for backward compatibility.
5. Re-run the targeted settings/navigation tests and confirm success.

### Task 8: Run full quality gates and manual acceptance

1. Run `gofmt` on changed Go files and `go mod tidy` from `services/server`.
2. Run `task check`, `task test`, and `task build` from `services/server`. The repository's `task check` already includes format, vet, lint, build and race tests; investigate root causes for any failure.
3. Run `pnpm lint`, `pnpm format`, the targeted Vitest files, the full test command used by the workspace package, and `pnpm build` from `apps/workspace`.
4. Start the local Electron development app and perform the six manual acceptance cases from the design document, including an isolated Codex Home and one malformed Skill.
5. Verify the browser network panel contains only GET requests for this feature and that viewing a Skill triggers no external request from its Markdown content.
6. Report changed files, verification results and any officially unsupported source that remains `unknown`; do not commit unless requested.
