# LibTV Image Generation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add LibTV-backed single-image generation routes for GPT Image 2, Nano Banana, and Seedream while reusing the existing image workspace, task handoff, polling, and asset storage flows.

**Architecture:** Keep three stable catalog routes and map them to the LibTV 1.0.2 model keys supplied by the user. Resolve the current CLI `modelName` from `model search --type=image` before submission, create `image` canvas nodes, and mark catalog routes `Async=false` so the existing background image runner can hand provider task IDs to the poller.

**Tech Stack:** Go, LibTV CLI 1.0.2, React 19, TypeScript, SWR, Vitest, Go task, existing generation catalog/runtime.

---

Use `@Code` for implementation discipline and `@executing-plans` to run these tasks in order. Keep the scope to one output image per request; force Seedream `sequential=0`, and do not add dynamic families, ZIP extraction, or a LibTV-specific page.

### Task 1: Add the three LibTV image catalog routes

**Files:**
- Create: `packages/core/pkg/generation/catalog_libtv_image.go`
- Modify: `packages/core/pkg/generation/catalog_adapters.go`
- Modify: `packages/core/pkg/generation/catalog_routes.go`
- Modify: `packages/core/pkg/generation/catalog_data.go`
- Test: `packages/core/pkg/generation/catalog_test.go`
- Test: `packages/core/pkg/generation/param_translation_test.go`

**Step 1: Write the failing catalog test**

Add a table-driven `TestLibTVImageCatalogIncludesRequestedRoutes` with these exact expectations:

```go
cases := []struct {
    id            string
    familyID      string
    versionID     string
    model         string
    maxReferences int
}{
    {RouteLibTVGPTImage2, FamilyGPTImage, VersionGPTImage2, "Lib Image", 10},
    {RouteLibTVNanoBanana31, FamilyNanoBanana, VersionNanoBanana31, "Lib Navo 2", 7},
    {RouteLibTVSeedream5Lite, FamilySeedream, VersionSeedream5Lite, "Seedream 5.0 Lite", 6},
}
```

For every route assert:

```go
if route.Provider != ProviderLibTV || route.Kind != KindImage ||
    route.Adapter != AdapterLibTVCLIImage || route.Async ||
    !route.SupportsReferenceURLs || route.MaxReferenceURLs != tc.maxReferences {
    t.Fatalf("route %q metadata = %#v", tc.id, route)
}
```

Also assert `AuthKeys == []string{ProviderLibTV}` and the expected parameter names/defaults.

**Step 2: Run the test and verify it fails**

Run from `packages/core`:

```bash
go test ./pkg/generation -run TestLibTVImageCatalogIncludesRequestedRoutes -count=1
```

Expected: FAIL because the adapter and route constants do not exist.

**Step 3: Add adapter and route constants**

Add:

```go
AdapterLibTVCLIImage = "libtv.cli.image"

RouteLibTVGPTImage2      = "libtv.gpt-image-2"
RouteLibTVNanoBanana31   = "libtv.gemini-3.1-flash-image-preview"
RouteLibTVSeedream5Lite  = "libtv.seedream-5-lite"
```

Keep the existing LibTV video constants unchanged.

**Step 4: Add LibTV-specific parameter builders**

Create `catalog_libtv_image.go` with three builders. Use CLI-confirmed values only:

```go
func libTVGPTImageParams() RouteParamConfig {
    params := []RouteParam{
        selectRouteParam(ParamAspectRatio, "16:9", libTVGPTImageRatios()),
        selectRouteParam(ParamResolution, "2K", libTVResolutionOptions("1K", "2K", "4K")),
        selectRouteParam(ParamQuality, "medium", []ParamOption{
            {Label: "Low", Value: "low"},
            {Label: "Medium", Value: "medium"},
            {Label: "High", Value: "high"},
        }),
    }
    return routeParamConfig(params, ParamTranslation{Moves: []ParamMove{
        {From: ParamAspectRatio, To: "ratio"},
        {From: ParamResolution},
        {From: ParamQuality},
    }})
}
```

Define the local helper in the same file; the similarly named helper under the
`mediago` subpackage is unexported and cannot be reused:

```go
func libTVResolutionOptions(values ...string) []ParamOption {
    options := make([]ParamOption, 0, len(values))
    for _, value := range values {
        options = append(options, ParamOption{Label: value, Value: value})
    }
    return options
}
```

Use these exact intersections between the inspected CLI schemas and the existing
MediaGo canonical aspect-ratio registry:

```go
// Lib Image; 1:2 and 2:1 are intentionally omitted because they are not
// registered canonical aspect ratios in this release.
[]string{"1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21"}

// Lib Navo 2; canonical `adaptive` is translated to the CLI value `auto`.
[]string{"adaptive", "1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "4:5", "5:4", "8:1", "1:8", "4:1", "1:4", "21:9"}

// Seedream 5.0 Lite
[]string{"1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3"}
```

Use `16:9` as the ratio default and `2K` as the resolution default for all three
routes; these match the inspected CLI 1.0.2 schemas. Lib Image quality defaults
to `medium`.

Nano Banana uses:

```go
ParamTranslation{Moves: []ParamMove{
    {
        From: ParamAspectRatio,
        To:   "ratio",
        Values: map[string]string{
            "adaptive": "auto",
        },
    },
    {From: ParamResolution, To: "quality"},
}}
```

Seedream uses the same moves without the `Values` mapping because it does not
offer an adaptive ratio, plus a provider-only constant that disables autonomous
multi-image output:

```go
Consts: []VendorConst{
    {To: "sequential", Value: 0},
}
```

Do not include `ParamN`, `search_enabled`, or a user-facing `sequential` control
in the MVP.

**Step 5: Register the routes under existing families**

Append one `libTVRoute(...)` to each existing family route list:

```go
libTVRoute(
    RouteLibTVGPTImage2,
    FamilyGPTImage,
    VersionGPTImage2,
    "LibTV",
    "Lib Image",
    AdapterLibTVCLIImage,
    "https://www.liblib.tv/cli",
    libTVGPTImageParams(),
    false,
    true,
    "",
    withReferenceURLLimit(10),
)
```

Use `Lib Navo 2`/7 and `Seedream 5.0 Lite`/6 for the other routes. The `false` async flag is intentional.

**Step 6: Add parameter translation tests**

Add table-driven assertions:

```go
// Lib Image
{"aspectRatio": "16:9", "resolution": "2K", "quality": "medium"}
// ->
{"ratio": "16:9", "resolution": "2K", "quality": "medium"}

// Lib Navo 2
{"aspectRatio": "3:4", "resolution": "2K"}
// ->
{"ratio": "3:4", "quality": "2K"}

// Seedream 5.0 Lite
{"aspectRatio": "3:4", "resolution": "3K"}
// ->
{"ratio": "3:4", "quality": "3K", "sequential": 0}
```

**Step 7: Run focused and package tests**

Run:

```bash
go test ./pkg/generation -run 'TestLibTVImage|Test.*ParamTranslation' -count=1
go test ./pkg/generation -count=1
```

Expected: PASS.

**Step 8: Commit**

```bash
git add packages/core/pkg/generation/catalog_libtv_image.go packages/core/pkg/generation/catalog_adapters.go packages/core/pkg/generation/catalog_routes.go packages/core/pkg/generation/catalog_data.go packages/core/pkg/generation/catalog_test.go packages/core/pkg/generation/param_translation_test.go
git commit -m "feat(generation): add libtv image catalog routes"
```

### Task 2: Resolve LibTV image model names by stable model key

**Files:**
- Modify: `packages/core/pkg/generation/libtv/provider.go`
- Test: `packages/core/pkg/generation/libtv/provider_test.go`

**Step 1: Write failing model-resolution tests**

Add table-driven tests for these mappings:

```go
var imageModelsByRoute = map[string]imageModelSpec{
    generation.RouteLibTVGPTImage2: {
        Key: "lib-image-2", CatalogName: "Lib Image",
    },
    generation.RouteLibTVNanoBanana31: {
        Key: "nebula-2-flash", CatalogName: "Lib Navo 2",
    },
    generation.RouteLibTVSeedream5Lite: {
        Key: "seedream-5", CatalogName: "Seedream 5.0 Lite",
    },
}
```

The fake runner should return a JSON `matches` array where the expected key has
a changed display name. Assert the resolver returns the discovered `modelName`,
not the static catalog label. `CatalogName` is for diagnostics only and must
never be used as a silent runtime fallback.

Add negative tests for:

- valid JSON without the expected key;
- malformed JSON;
- non-zero CLI exit.

**Step 2: Run the tests and verify failure**

Run from `packages/core`:

```bash
go test ./pkg/generation/libtv -run 'TestResolveImageModelName' -count=1
```

Expected: FAIL because the resolver does not exist.

**Step 3: Add the search response types and route mapping**

Implement unexported concrete types:

```go
type imageModelSpec struct {
    Key         string
    CatalogName string
}

type modelSearchResponse struct {
    Matches []struct {
        ModelKey  string `json:"modelKey"`
        ModelName string `json:"modelName"`
    } `json:"matches"`
}
```

Keep the route-to-key mapping in the LibTV package so no public catalog DTO field is added.

**Step 4: Implement exact-key resolution**

Run:

```text
libtv model search --type=image
```

Pass stdout through the provider's existing `extractJSONObject` helper so CLI
log lines do not corrupt an otherwise valid response. That helper returns
`map[string]any`; marshal the extracted map and unmarshal it into the concrete
`modelSearchResponse` above before matching `modelKey` exactly. Return the
response `modelName`. If the key is absent, return an error like:

```text
当前 LibTV CLI/账号未提供模型 lib-image-2（GPT Image 2 / Lib Image）
```

Do not silently substitute a different LibTV model.

**Step 5: Run focused tests**

```bash
go test ./pkg/generation/libtv -run 'TestResolveImageModelName' -count=1
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/core/pkg/generation/libtv/provider.go packages/core/pkg/generation/libtv/provider_test.go
git commit -m "feat(generation): validate libtv image models"
```

### Task 3: Generate LibTV image nodes and validate references

**Files:**
- Modify: `packages/core/pkg/generation/libtv/provider.go`
- Test: `packages/core/pkg/generation/libtv/provider_test.go`
- Test: `packages/core/pkg/generation/runtime/provider_test.go`

**Step 1: Write the failing pure text-to-image command test**

Create `TestGenerateImageCreatesAndRunsLibTVNode`. The runner should receive model search first, then node creation. Assert node args include:

```text
node
--project=project-123
create
mediago-image-1000000234
--type=image
--prompt=make an image
--set=model=Lib Image
--set=ratio=16:9
--set=resolution=2K
--set=quality=medium
--set=count=1
--run
```

Assert response ID is `libtv.gpt-image-2:project-123:node_123` and status is `submitted`.

**Step 2: Write the failing route-specific parameter tests**

Add one test each for:

- `Lib Navo 2`: canonical `resolution=4K` becomes `--set=quality=4K`.
- `Seedream 5.0 Lite`: canonical `resolution=3K` becomes `--set=quality=3K` and the command contains `--set=sequential=0`.
- No image route emits video-only `duration` or `enableSound` flags.

**Step 3: Write the failing image-reference test**

Use a temporary PNG. Assert the calls are:

1. model search;
2. upload;
3. node create.

Assert node args include the uploaded node ID and:

```text
--set=modeType=image2image
--left-add=<reference-node-id>
```

**Step 4: Write failing rejection tests**

Pass temporary `.mp4` and `.wav` references separately. Assert generation fails
before model search, automatic project creation, or `upload`, with a message that
LibTV image routes only accept image references.

**Step 5: Run focused tests and verify failure**

```bash
go test ./pkg/generation/libtv -run 'TestGenerateImage' -count=1
```

Expected: FAIL because `Generate` still rejects non-video kinds.

**Step 6: Refactor argument construction by kind**

After route resolution, materialize references to local metadata and validate
their kinds before resolving/creating a LibTV project or invoking any other CLI
side effect. Then construct arguments by kind:

```go
switch request.Kind {
case generation.KindImage:
    // validate image references, resolve modelName, append image params
case generation.KindVideo:
    // retain existing video params and mixed2video behavior
default:
    return generation.Response{}, fmt.Errorf("libtv CLI does not support %s generation routes", request.Kind)
}
```

For images append only the allowlisted translated keys `ratio`, `resolution`,
`quality`, and `sequential`; always append `count=1`, and append
`modeType=image2image` only when references exist. Reject a caller-supplied
`sequential` value for non-Seedream routes; the only accepted value comes from
the Seedream route translation const and is `0`.

**Step 7: Add runtime dispatch coverage**

Add a runtime provider test using a fake executable or injected runner fixture. Assert `RouteLibTVGPTImage2` dispatches to LibTV and emits `--type=image`.

Do not remove the existing LibTV video dispatch test.

**Step 8: Run provider and runtime tests**

```bash
go test ./pkg/generation/libtv -count=1
go test ./pkg/generation/runtime -run 'TestProviderDispatchesLibTV' -count=1
```

Expected: PASS.

**Step 9: Commit**

```bash
git add packages/core/pkg/generation/libtv/provider.go packages/core/pkg/generation/libtv/provider_test.go packages/core/pkg/generation/runtime/provider_test.go
git commit -m "feat(generation): generate images through libtv"
```

### Task 4: Preserve image asset kinds and reject ZIP results safely

**Files:**
- Modify: `packages/core/pkg/generation/libtv/provider.go`
- Test: `packages/core/pkg/generation/libtv/provider_test.go`

**Step 1: Write failing download tests**

Add tests that create download directories containing:

- `.png` -> `KindImage`, `image/png`;
- `.jpg` -> `KindImage`, `image/jpeg`;
- `.webp` -> `KindImage`, `image/webp`;
- `.zip` -> explicit unsupported archive error.

Keep a video file assertion to protect current behavior.

**Step 2: Run the tests and verify the ZIP case fails**

```bash
go test ./pkg/generation/libtv -run 'TestAssetsFromDownloadDir' -count=1
```

Expected: FAIL because `application/zip` currently falls back to `KindVideo`.

**Step 3: Make MIME-to-kind conversion explicit**

Replace the unconditional fallback with a checked result:

```go
func kindForMIMEType(mimeType string) (generation.Kind, bool) {
    switch {
    case strings.HasPrefix(mimeType, "image/"):
        return generation.KindImage, true
    case strings.HasPrefix(mimeType, "video/"):
        return generation.KindVideo, true
    case strings.HasPrefix(mimeType, "audio/"):
        return generation.KindAudio, true
    default:
        return "", false
    }
}
```

When a file is `application/zip`, return a message explaining that the current LibTV integration supports single-image output only. Reject other unknown MIME types instead of labeling them as video.

**Step 4: Run tests**

```bash
go test ./pkg/generation/libtv -count=1
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/pkg/generation/libtv/provider.go packages/core/pkg/generation/libtv/provider_test.go
git commit -m "fix(generation): classify libtv download assets safely"
```

### Task 5: Verify background image handoff, polling, and pricing

**Files:**
- Modify: `services/server/configs/pricing.overlay.json`
- Modify: `services/server/internal/service/generation/generation_runtime_tasks.go`
- Test: `services/server/internal/service/generation/generation_runtime_test.go`
- Create: `services/server/internal/service/generation/generation_libtv_catalog_test.go`
- Test: `services/server/internal/app/mcp/generation_test.go`

**Step 1: Write a failing route lifecycle test**

Use a stub image provider whose `Generate` returns:

```go
coregeneration.Response{
    ID: "libtv.gpt-image-2:project-123:node-123",
    Status: "submitted",
}
```

Create a generation message for `RouteLibTVGPTImage2`. Assert:

- the immediate HTTP response is an active image task with a local task ID;
- the persisted route has `Async=false`;
- after the background runner executes, `ProviderTaskID` contains the LibTV node ID;
- `PollGenerationTask` completes the same local task with `KindImage` assets.

**Step 2: Run and verify the lifecycle test fails**

Run from `services/server`:

```bash
go test ./internal/service/generation -run 'TestLibTVImage.*Handoff|TestLibTVImage.*Poll' -count=1
```

Expected: FAIL until the new routes and provider behavior are wired.

**Step 3: Generalize the timeout copy**

Change:

```text
即梦生成超时
```

to:

```text
图片生成超时
```

Keep the existing maximum background image age.

Add a regression case where `provider.Get` returns an error after that age. In
the poll error branch, persist the task as failed with the generic timeout once
an image task has expired; before the age cap, retain the current retry behavior.
This prevents a permanently failing LibTV status check from leaving a task active
forever.

**Step 4: Preserve the stored task kind in manual result polling**

In `GetGenerationVideo`, derive the fallback kind from `storedTask.Kind` when the task exists; only use `video` for legacy calls without a stored task. Do not rename the public method in this feature.

**Step 5: Add external pricing entries**

Append:

```json
{
  "routeId": "libtv.gpt-image-2",
  "currency": "CNY",
  "unit": "external"
},
{
  "routeId": "libtv.gemini-3.1-flash-image-preview",
  "currency": "CNY",
  "unit": "external"
},
{
  "routeId": "libtv.seedream-5-lite",
  "currency": "CNY",
  "unit": "external"
}
```

**Step 6: Add catalog and MCP regression assertions**

Assert:

- all three routes are returned by `ListGenerationModels`;
- their `configured` flag follows the LibTV OAuth marker;
- MCP `list_generation_models` includes them as `kind=image`;
- existing image-generation MCP payloads need no schema change.

**Step 7: Run server tests**

```bash
go test ./internal/service/generation -count=1
go test ./internal/app/mcp -count=1
```

Expected: PASS.

**Step 8: Commit**

```bash
git add services/server/configs/pricing.overlay.json services/server/internal/service/generation/generation_runtime_tasks.go services/server/internal/service/generation/generation_runtime_test.go services/server/internal/service/generation/generation_libtv_catalog_test.go services/server/internal/app/mcp/generation_test.go
git commit -m "fix(generation): poll libtv image tasks safely"
```

### Task 6: Add frontend fallback catalog parity

**Files:**
- Modify: `apps/workspace/src/domains/generation/hooks/generationFallbackParams.ts`
- Modify: `apps/workspace/src/domains/generation/hooks/generationFallbackCatalog.ts`
- Modify: `apps/workspace/src/domains/generation/hooks/generationCatalog.ts`
- Test: `apps/workspace/src/domains/generation/hooks/generationFallbackCatalog.test.ts`
- Test: `apps/workspace/src/domains/generation/hooks/useGenerationReferences.test.tsx`
- Test: `apps/workspace/src/domains/generation/components/GenerationModelRoutePicker.test.tsx`
- Test: `apps/workspace/src/domains/generation/hooks/useGenerationSubmit.test.ts`

**Step 1: Write failing fallback catalog tests**

Assert the three routes have the same client-visible IDs, family/version IDs,
model names, adapter, reference limits, parameter options, and defaults as the
Go catalog. Backend `Translation` is intentionally not serialized to the client,
so do not invent a frontend translation field.

Assert `async === false`, `provider === "libtv"`, and `kind === "image"`.

**Step 2: Write failing reference-policy tests**

For a `libtv.cli.image` route, assert:

- image references are selectable;
- video and audio references are rejected;
- the route-specific maximum is honored.

Keep the existing test that `libtv.cli.video` accepts image/video/audio.

**Step 3: Run focused tests and verify failure**

Run from `apps/workspace`:

```bash
pnpm test -- generationFallbackCatalog.test.ts useGenerationReferences.test.tsx
```

Expected: FAIL because fallback routes are absent.

**Step 4: Add fallback parameter builders and routes**

Mirror the backend's client-visible route data exactly. Do not create a new page
or a new family. Add `libtv: "local"` to `fallbackProviderTypes` as defensive
parity.

**Step 5: Add picker and submit regression tests**

Assert:

- the existing version can show LibTV beside other providers;
- selecting LibTV returns the correct route ID;
- submitted payload contains `kind=image`, route/family/version/provider/model, canonical params, and image references;
- switching provider restores per-route params.

**Step 6: Run focused frontend tests**

```bash
pnpm test -- generationFallbackCatalog.test.ts useGenerationReferences.test.tsx GenerationModelRoutePicker.test.tsx useGenerationSubmit.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add apps/workspace/src/domains/generation/hooks/generationFallbackParams.ts apps/workspace/src/domains/generation/hooks/generationFallbackCatalog.ts apps/workspace/src/domains/generation/hooks/generationCatalog.ts apps/workspace/src/domains/generation/hooks/generationFallbackCatalog.test.ts apps/workspace/src/domains/generation/hooks/useGenerationReferences.test.tsx apps/workspace/src/domains/generation/components/GenerationModelRoutePicker.test.tsx apps/workspace/src/domains/generation/hooks/useGenerationSubmit.test.ts
git commit -m "feat(workspace): expose libtv image routes"
```

### Task 7: Refresh the model catalog after LibTV credential changes

**Files:**
- Modify: `apps/workspace/src/pages/Settings.tsx`
- Test: `apps/workspace/src/pages/Settings.test.tsx`

**Step 1: Write failing cache invalidation tests**

Mock global SWR mutate and assert `generationModelsKey` is revalidated after:

- OAuth login completes immediately;
- device-code confirmation completes;
- the existing login polling effect changes a pending challenge to configured;
- a credential is saved;
- a credential is cleared.

Retain assertions for Agent runtime config invalidation.

**Step 2: Run and verify failure**

```bash
pnpm test -- Settings.test.tsx
```

Expected: FAIL because only Agent runtime config is currently revalidated.

**Step 3: Add one shared invalidation helper**

Import `generationModelsKey` and replace the Agent-only helper with:

```ts
const revalidateModelDependentCaches = () => {
    void mutateGlobal(generationModelsKey, undefined, { revalidate: true });
    void mutateGlobal(isAgentRuntimeConfigKey, undefined, { revalidate: true });
};
```

Call it only after successful save, clear, immediate login, login confirmation,
or when the existing provider polling effect observes the pending-to-configured
transition. Remove the completed challenge before revalidating so the effect
cannot repeat the completion path. Do not revalidate on a still-pending login
challenge.

**Step 4: Run settings tests**

```bash
pnpm test -- Settings.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/workspace/src/pages/Settings.tsx apps/workspace/src/pages/Settings.test.tsx
git commit -m "fix(settings): refresh generation models after login"
```

### Task 8: Run full quality gates and Windows compile checks

**Files:**
- Modify only files needed to fix failures caused by this feature.

**Step 1: Run core quality gates**

From `packages/core`:

```bash
task check
```

Expected: PASS, including race tests.

**Step 2: Run MCP quality gates**

From `packages/mcp`:

```bash
task check
task test
```

Expected: PASS.

**Step 3: Run server quality gates**

From `services/server`:

```bash
task check
task test
task build
```

Expected: PASS.

**Step 4: Run the full workspace frontend suite**

From `apps/workspace`:

```bash
pnpm test
pnpm lint
pnpm format
pnpm build
```

Expected: PASS.

**Step 5: Cross-compile Go packages for Windows**

From `packages/core` and then `services/server`:

```bash
GOOS=windows GOARCH=amd64 go build ./...
```

Expected: PASS. Do not use Unix shell-script fake CLIs for Windows-specific assertions; keep provider command tests on the injected `CommandRunner`.

**Step 6: Perform manual LibTV acceptance on Windows x64**

With a test account:

1. Log into LibTV from Settings.
2. Confirm the image model picker shows LibTV for GPT Image 2, Nano Banana, and Seedream.
3. Generate one text-only image with each route.
4. Generate one image-reference request with each route.
5. Refresh or restart while a task is pending and confirm it completes from persisted state.
6. Clear LibTV login and confirm the routes become unavailable without restarting the app.

Expected: all six checks pass and generated assets appear in history/material storage as images.

**Step 7: Review the final diff**

```bash
git status --short
git diff --check
git diff --stat
```

Expected: only the planned files are changed and `git diff --check` prints nothing.

**Step 8: Commit any final test-only adjustments**

```bash
git add <explicit-files-only>
git commit -m "test(generation): cover libtv image workflows"
```

Do not push without an explicit user request.
