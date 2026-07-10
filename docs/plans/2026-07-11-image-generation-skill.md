# Image Generation Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the Agent-facing image-generation workflow out of the global tool instruction and into a built-in, on-demand `image-generation` Skill without changing server-side generation execution.

**Architecture:** Keep one short mandatory trigger and the shared media-task rules in `TOOLS.md`. Package the complete image workflow as a built-in prompt-pack Skill loaded through the existing `load_skill` MCP tool. Preserve model routing, validation, background execution, asset caching, document attribution, and selection persistence in the generation service.

**Tech Stack:** Go 1.25, embedded prompt-pack Markdown, MCP `load_skill`, Go tests and prompt golden files.

---

### Task 1: Define the Skill boundary with tests

**Files:**

- Modify: `packages/instructions/pkg/pack/builtin/builtin_test.go`
- Modify: `packages/instructions/pkg/official/official_test.go`
- Modify: `services/server/internal/service/prompt/prompt_workspace_test.go`

**Step 1: Write the failing built-in pack test**

Expect eight built-in Skills, require an `image-generation` entry, and assert that it owns the complete image workflow, including model discovery, target disambiguation, parameter confirmation, references, prompt optimization, document context, polling, selection, notifications, and failure handling.

**Step 2: Write the failing global-instruction boundary test**

Assert that `TOOLS.md` requires `load_skill(name: "image-generation")` for image generation while no longer containing the detailed image workflow heading or parameter-form instructions.

**Step 3: Run tests and verify failure**

Run:

```bash
go test ./pkg/pack/builtin ./pkg/official
```

from `packages/instructions`, and:

```bash
go test ./internal/service/prompt
```

from `services/server`.

Expected: tests fail because the Skill does not exist and detailed instructions still live globally.

### Task 2: Add the built-in image-generation Skill

**Files:**

- Create: `packages/instructions/pkg/pack/builtin/assets/skills/image-generation.skill.md`

**Step 1: Add concise frontmatter**

Use `name: image-generation`, a user-facing title, and a trigger-oriented description covering image generation, illustration, visual assets, reference-image generation, and image selection. Do not attach a document category because the Skill applies across project and document contexts.

**Step 2: Add the deterministic workflow**

Define target resolution, `list_generation_models(kind=image)`, style recommendation, a single `ask_user_form`, exact `generate_media` argument mapping, polling, multi-image selection, document insertion, and final response.

**Step 3: Add guardrails and error branches**

Require configured routes, prohibit invented route IDs or params, stop on cancelled/expired confirmation, preserve references only on compatible routes, provide notification targets for background work, and avoid exposing internal field names.

### Task 3: Reduce the global tool instruction

**Files:**

- Modify: `packages/instructions/pkg/official/assets/instructions/TOOLS.md`

**Step 1: Replace the detailed image workflow**

Keep shared generation tool names and background-task semantics needed for video/audio. Add one hard rule requiring the Agent to load `image-generation` before every image-generation or image-editing request.

**Step 2: Remove duplicated image-only procedure**

Remove style recommendation, generation parameter form, reference-image form, image-specific document context, and image selection details from the global prompt.

### Task 4: Refresh prompt expectations and verify

**Files:**

- Modify: `services/server/internal/service/prompt/testdata/*.golden`

**Step 1: Refresh golden prompts**

Update only the fixed `TOOLS.md` portion of every prompt fixture so it reflects the shorter trigger rule.

**Step 2: Run focused tests**

Run the instruction pack, official instruction, Skill registry, MCP adapter, and prompt tests.

**Step 3: Run package quality gates**

Run:

```bash
task check
task test
```

in `packages/instructions`, followed by the relevant server tests and `go test -race` for touched server packages.

### Task 5: Forward-test Skill behavior

**Files:**

- Inspect: `packages/instructions/pkg/pack/builtin/assets/skills/image-generation.skill.md`

**Step 1: Give an independent agent only the Skill and a realistic request**

Use a request such as generating a consistent new-stage character portrait from an existing approved image.

**Step 2: Check the proposed tool sequence**

Require it to load models, disambiguate the target when needed, use one generation form, preserve the reference asset, pass document context, poll the task, and ask the user to choose among multiple results.

**Step 3: Tighten the Skill if any required action is missed**

Re-run focused tests after revisions.
