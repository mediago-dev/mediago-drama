# Agent 图片生成设置与批量表单同源 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 移除 Agent 图片/视频生成前的独立通用风格选择，并让 Agent 图片生成确认完整复用批量生成表单的字段、状态、校验和提交语义。

**Architecture:** 从现有 `BatchGenerationSettingsDialog` 抽出一个 kind-aware 的共享 controller 与纯表单主体，由批量弹窗和 Agent 图片确认卡分别套用自己的外壳。新增单一复合字段 `generation_settings` 承载路由参数、参考图、补充提示词和优化提示词；服务端将补充提示词作为结构化输入应用，并把完整设置纳入同 run 用户确认授权。

**Tech Stack:** React 19、TypeScript、Vite、SWR、Zustand、Tailwind CSS v4、Go、Gin、Gorm、MCP、Vitest、Go testing/race detector。

---

## 已确认范围

- 移除的是 Agent 在参数确认前基于 `stylePresets` 发起的独立“选择风格”步骤。
- 用户可维护提示词包里的“风格”分类继续保留；用户新增或删除提示词包后，表单实时同步。
- 模型 route schema 如果声明了名为 `style` 的参数，仍按批量表单规则展示，不能过滤。
- 图片 Agent 本轮切换为完整共享表单。
- 视频 Agent 本轮只保证不出现独立通用风格选择；共享组件和协议保持 kind-aware，但不切换视频确认 UI。
- 批量弹窗与 Agent 图片确认在字段、顺序、默认值、校验和提交语义上同源；标题、“已选 N 项”等外壳文案按场景区分。
- HTTP 生成目录和提示词库继续保留现有能力；只移除 Agent MCP 对旧 `stylePresets` 工作流的暴露和依赖。

## 执行前提

当前工作区已有尚未提交的 selection 生命周期、共享 route 参数控件和 generation confirmation 改动。本计划依赖这些改动，执行前必须先把它们安全保存在目标分支或同一工作树中；不得从一个缺少这些改动的旧 HEAD 直接开始，也不得暂存无关的 ACP、Agent final-answer phase 或其他并行修改。

### Task 1: 锁定“无独立风格选择”的 Agent 契约

**Files:**
- Modify: `packages/instructions/pkg/pack/builtin/assets/skills/image-generation.skill.md`
- Modify: `packages/instructions/pkg/pack/builtin/assets/skills/video-generation.skill.md`
- Modify: `packages/instructions/pkg/pack/builtin/builtin_test.go`
- Modify: `packages/mcp/pkg/mcp/tools.go`
- Modify: `packages/mcp/pkg/mcp/mcp_test.go`
- Modify: `services/server/internal/app/mcp/generation_convert.go`
- Modify: `services/server/internal/app/mcp/generation_test.go`

**Step 1: 写失败测试**

新增测试，要求：

- 图片 Skill 不再包含“从 `stylePresets` 推荐”“调用 `ask_user_selection` 选择风格”“拼接 `promptSuffix`”。
- 图片 Skill 明确要求直接打开统一生成设置表单，风格来自用户可维护提示词包或业务 prompt。
- 视频 Skill 明确禁止独立通用风格选择。
- Agent generation MCP 的 `list_generation_models` 输出不再携带 `stylePresets`，但服务层 HTTP 模型目录测试仍保持原行为。
- MCP instructions/tool description 不再宣传 `stylePresets`。

建议测试名：

- `TestImageGenerationSkillUsesDynamicPromptPacksInsteadOfStyleSelection`
- `TestVideoGenerationSkillDoesNotAskForStandaloneStyle`
- `TestGenerationModelsOutputOmitsAgentStylePresets`
- `TestGenerationInstructionsDoNotAdvertiseStylePresets`

**Step 2: 运行测试确认失败**

Run:

```bash
cd packages/instructions && go test ./pkg/pack/builtin -run 'GenerationSkill' -count=1
cd packages/mcp && go test ./pkg/mcp -run 'GenerationInstructions' -count=1
cd services/server && go test ./internal/app/mcp -run 'GenerationModelsOutputOmitsAgentStylePresets' -count=1
```

Expected: FAIL，错误应指出旧 Skill/工具描述仍包含 `stylePresets` 或 MCP 输出仍返回风格 preset。

**Step 3: 实现最小契约变更**

- 删除图片 Skill 的独立风格选择阶段以及 preset `promptSuffix`/`params` 合并逻辑。
- 将图片流程改为：锁定目标 → 获取 configured 图片路由 → 打开统一图片设置表单。
- 保留用户已在自然语言明确提出的画风要求，作为业务 prompt 的一部分；不要自动映射成全局 preset。
- 视频 Skill 保持当前模型/参数流程，并增加禁止通用风格卡的硬性说明。
- `generationModelsOutputFromService` 在 MCP adapter 层把 `StylePresets` 置空；不要删除服务 DTO、HTTP API 或提示词库数据。
- 更新 MCP instructions 和 `ListModels` 描述，说明风格/补充内容由统一表单中的动态提示词包选择。

**Step 4: 重跑测试**

Run:

```bash
cd packages/instructions && go test -race ./...
cd packages/mcp && go test -race ./...
cd services/server && go test -race ./internal/app/mcp
```

Expected: PASS。

**Step 5: 提交**

```bash
git add packages/instructions/pkg/pack/builtin/assets/skills/image-generation.skill.md packages/instructions/pkg/pack/builtin/assets/skills/video-generation.skill.md packages/instructions/pkg/pack/builtin/builtin_test.go packages/mcp/pkg/mcp/tools.go packages/mcp/pkg/mcp/mcp_test.go services/server/internal/app/mcp/generation_convert.go services/server/internal/app/mcp/generation_test.go
git commit -m "fix(agent): remove standalone generation style selection"
```

### Task 2: 定义共享图片设置值与纯转换函数

**Files:**
- Create: `apps/workspace/src/domains/generation/components/generationSettingsValue.ts`
- Create: `apps/workspace/src/domains/generation/components/generationSettingsValue.test.ts`
- Modify: `apps/workspace/src/domains/generation/api/generation.ts`
- Modify: `apps/workspace/src/domains/generation/stores/batch-generation-settings.ts`

**Step 1: 写失败测试**

覆盖：

- 删除未知 route 参数并补全 schema 默认值。
- count、ratio/resolution combo 与批量表单现有规则一致。
- 参考图 ID 去空、去重且保持顺序。
- 补充提示词按 ID/内容去重，保存提交时的名称和 prompt 快照。
- 优化提示词关闭时规范化为 `{ enabled: false }`；开启时必须有 text route 和提示词包。
- 用户已删除的提示词包 ID 会从恢复状态中清理。

**Step 2: 运行测试确认失败**

Run:

```bash
cd apps/workspace
pnpm exec vitest run src/domains/generation/components/generationSettingsValue.test.ts
```

Expected: FAIL，因为共享值类型和 normalization helper 尚不存在。

**Step 3: 实现共享类型**

```ts
export interface GenerationPromptSupplementValue {
  referenceId?: string;
  referenceName: string;
  referencePrompt: string;
}

export interface GenerationPromptOptimizationValue {
  enabled: boolean;
  routeId?: string;
  label?: string;
  referenceId?: string;
  referenceName?: string;
  referencePrompt?: string;
}

export interface GenerationSettingsValue {
  kind: "image" | "video";
  routeId: string;
  label: string;
  params: Record<string, unknown>;
  referenceAssetIds: string[];
  promptSupplements: GenerationPromptSupplementValue[];
  promptOptimization: GenerationPromptOptimizationValue;
}
```

实现：

- `normalizeGenerationSettingsValue(catalog, kind, rawValue, promptItems)`
- `generationSettingsValueForSubmit(...)`
- `formatGenerationSettingsValue(value)`
- batch preference 与完整提交值之间的 adapter；localStorage 只保存 route/params/提示词包 ID/开关，不保存参考图。

默认值优先级固定为：

1. 当前卡片内用户编辑；
2. 本次 Agent 提供的明确上下文默认值；
3. `generation.batch-settings.v1` 中同 kind 的用户偏好；
4. generation preferences；
5. 第一个 configured route。

**Step 4: 重跑测试**

Run:

```bash
cd apps/workspace
pnpm exec vitest run src/domains/generation/components/generationSettingsValue.test.ts
```

Expected: PASS。

**Step 5: 提交**

```bash
git add apps/workspace/src/domains/generation/components/generationSettingsValue.ts apps/workspace/src/domains/generation/components/generationSettingsValue.test.ts apps/workspace/src/domains/generation/api/generation.ts apps/workspace/src/domains/generation/stores/batch-generation-settings.ts
git commit -m "feat(generation): define shared generation settings value"
```

### Task 3: 让补充提示词成为服务端支持的结构化生成输入

**Files:**
- Modify: `packages/mcp/pkg/mcp/generation_types.go`
- Modify: `packages/mcp/pkg/mcp/mcp_test.go`
- Modify: `services/server/internal/http/dto/generation.go`
- Modify: `services/server/internal/app/mcp/generation_convert.go`
- Modify: `services/server/internal/app/mcp/generation_test.go`
- Create: `services/server/internal/service/generation/generation_prompt_supplements.go`
- Create: `services/server/internal/service/generation/generation_prompt_supplements_test.go`
- Modify: `services/server/internal/service/generation/generation_runtime.go`
- Modify: `services/server/internal/service/generation/generation_runtime_prompt_optimize.go`

**Step 1: 写失败测试**

定义服务端用例：

- 空名称允许、空 prompt 丢弃。
- 补充 prompt trim、去重且保持选择顺序。
- base prompt 已包含某个完整 supplement 时不重复追加。
- 普通生成与“优化后生成”都先追加 supplements；优化模型看到的是追加后的 prompt。
- MCP single/batch conversion 完整保留 supplements。

**Step 2: 运行测试确认失败**

Run:

```bash
cd services/server
go test ./internal/service/generation -run 'PromptSupplements' -count=1
go test ./internal/app/mcp -run 'PromptSupplements' -count=1
```

Expected: FAIL，因为 request DTO 和应用函数尚不存在。

**Step 3: 实现结构化输入**

```go
type GenerationPromptSupplementRequest struct {
    ReferenceID     string `json:"referenceId,omitempty"`
    ReferenceName   string `json:"referenceName,omitempty"`
    ReferencePrompt string `json:"referencePrompt"`
}
```

- 在 MCP input、HTTP DTO 和 service alias 中增加 `promptSupplements`。
- 新建 `NormalizeGenerationPromptSupplements` 与 `ApplyGenerationPromptSupplements`。
- 在普通生成和提示词优化入口的 prompt 必填校验之前应用 supplements。
- 应用后清空内部临时 supplements 或确保重试不会再次追加。
- 不在 Agent/前端手工拼接；服务端成为唯一追加实现。

**Step 4: 重跑测试**

Run:

```bash
cd services/server
go test -race ./internal/service/generation ./internal/app/mcp
cd packages/mcp && go test -race ./...
```

Expected: PASS。

**Step 5: 提交**

```bash
git add packages/mcp/pkg/mcp/generation_types.go packages/mcp/pkg/mcp/mcp_test.go services/server/internal/http/dto/generation.go services/server/internal/app/mcp/generation_convert.go services/server/internal/app/mcp/generation_test.go services/server/internal/service/generation/generation_prompt_supplements.go services/server/internal/service/generation/generation_prompt_supplements_test.go services/server/internal/service/generation/generation_runtime.go services/server/internal/service/generation/generation_runtime_prompt_optimize.go
git commit -m "feat(generation): support structured prompt supplements"
```

### Task 4: 抽取共享生成设置 controller 与无外壳表单

**Files:**
- Create: `apps/workspace/src/domains/generation/hooks/useGenerationSettingsForm.ts`
- Create: `apps/workspace/src/domains/generation/hooks/useGenerationSettingsForm.test.tsx`
- Create: `apps/workspace/src/domains/generation/components/GenerationSettingsForm.tsx`
- Create: `apps/workspace/src/domains/generation/components/GenerationSettingsForm.test.tsx`
- Modify: `apps/workspace/src/domains/generation/components/generationSettingsValue.ts`
- Modify: `apps/workspace/src/domains/generation/stores/batch-generation-settings.ts`

**Step 1: 写 controller 失败测试**

用 `renderHook` 覆盖：

- 同 kind 恢复 `generation.batch-settings.v1` 中最近一次模型、route 参数、补充提示词包和优化配置。
- Agent 卡片传入的本次任务默认值覆盖已保存偏好；用户开始编辑后，catalog 刷新不能覆盖当前值。
- 用户删除提示词包后，已保存但已失效的 ID 被清理；用户新增任意分类（包括名字叫“风格”的分类）后可立即选择。
- image route 不支持参考图时自动清空 references；支持时保留已有资产 ID。
- 补充提示词开启但未选包、优化开启但缺文本 route/提示词包时，`isValid=false`。
- workspace 请求只使用 `projectStyleOnly: true`、`useRawPrompt: true`、`persistModelSelection: false`，不请求或消费独立 `stylePresets`。

建议测试名：

- `restores_last_settings_for_kind`
- `explicit_task_defaults_win_over_saved_preferences`
- `preserves_current_edits_after_catalog_refresh`
- `prunes_deleted_prompt_pack_ids_after_catalog_load`
- `clears_references_for_routes_without_reference_support`
- `reports_invalid_until_enabled_prompt_features_are_complete`
- `never_requests_standalone_style_presets`

**Step 2: 写共享表单失败测试**

要求 `GenerationSettingsForm` 只渲染表单主体，不包含 Dialog、选中数量或提交/取消按钮，并按批量弹窗当前顺序展示：

1. 模型；
2. route schema 参数；
3. 参考图（仅支持参考图的 image route）；
4. 补充提示词；
5. 优化提示词。

再覆盖：动态 route 参数组合、补充提示词多选、优化提示词单选+文本模型、用户自定义“风格”提示词包，以及每次编辑都向上游发出完整 `GenerationSettingsValue`。

建议测试名：

- `renders_sections_in_batch_form_order`
- `renders_route_schema_controls_without_filtering_style_named_params`
- `renders_user_managed_style_prompt_packs_as_dynamic_packs`
- `selects_multiple_prompt_supplements`
- `requires_prompt_pack_and_text_route_for_optimization`
- `shows_references_only_for_capable_image_routes`
- `emits_one_complete_settings_value`

**Step 3: 运行测试确认失败**

Run:

```bash
cd apps/workspace
pnpm exec vitest run src/domains/generation/hooks/useGenerationSettingsForm.test.tsx src/domains/generation/components/GenerationSettingsForm.test.tsx
```

Expected: FAIL，因为共享 hook 和表单尚不存在。

**Step 4: 搬迁状态与视图，不复制实现**

- `useGenerationSettingsForm` 负责 catalog/prompt pack 加载、默认值合并、route 切换、参数 normalization、参考图、补充提示词、优化提示词、持久化和 `isReady/isBusy/isValid`。
- 复用 `generationRouteParamControls.ts` 作为 route schema 参数的唯一解析入口；不得在 Agent 侧另写 ratio/resolution/count 映射。
- 从 `BatchGenerationSettingsDialog.tsx` 原样迁出 `PromptPackSelect`、`PromptPackChips`、`LabeledInlineControl` 及其纯展示逻辑到 `GenerationSettingsForm.tsx`。
- 表单 props 只接收共享 controller/value、`projectId` 所需的资产选择能力和禁用态；不得接收批量数量、Modal open 状态或按钮文案。
- 本步骤先保留批量弹窗旧实现，避免在共享组件未通过定向测试前删除可工作的代码；重复代码在 Task 5 迁移成功后删除。

**Step 5: 重跑定向测试**

Run:

```bash
cd apps/workspace
pnpm exec vitest run src/domains/generation/components/generationSettingsValue.test.ts src/domains/generation/hooks/useGenerationSettingsForm.test.tsx src/domains/generation/components/GenerationSettingsForm.test.tsx
```

Expected: PASS。

**Step 6: 提交**

```bash
git add apps/workspace/src/domains/generation/hooks/useGenerationSettingsForm.ts apps/workspace/src/domains/generation/hooks/useGenerationSettingsForm.test.tsx apps/workspace/src/domains/generation/components/GenerationSettingsForm.tsx apps/workspace/src/domains/generation/components/GenerationSettingsForm.test.tsx apps/workspace/src/domains/generation/components/generationSettingsValue.ts apps/workspace/src/domains/generation/stores/batch-generation-settings.ts
git commit -m "refactor(generation): extract shared generation settings form"
```

### Task 5: 让批量生成弹窗成为共享表单的第一个 adapter

**Files:**
- Modify: `apps/workspace/src/domains/generation/components/BatchGenerationSettingsDialog.tsx`
- Modify: `apps/workspace/src/domains/generation/components/BatchGenerationSettingsDialog.test.ts`
- Modify: `apps/workspace/src/domains/generation/components/BatchGenerationSettingsDialog.render.test.tsx`
- Modify: `apps/workspace/src/pages/ProjectOverview.tsx`
- Modify: `apps/workspace/src/pages/ProjectOverview.test.tsx`
- Modify: `apps/workspace/src/domains/generation/api/generation.ts`
- Modify: `apps/workspace/src/api/types/generation.ts`

**Step 1: 先把现有批量行为写成回归测试**

保留现有测试，并补充断言：

- 弹窗主体由 `GenerationSettingsForm` 渲染，区块名称和顺序不变。
- `selectedCount`、标题、取消按钮和确认按钮仍由批量外壳负责。
- route/params、参考图、补充提示词、优化提示词的确认 payload 与共享值一一对应。
- 关闭后重开恢复同 kind 最近设置，但不恢复上次临时参考图。
- 图片和视频使用各自偏好；视频不出现独立通用风格控件。
- `ProjectOverview` 把 `promptSupplements` 作为结构化字段传给生成 API，base prompt 不在浏览器端被改写。

建议新增测试名：

- `renders_the_shared_generation_settings_form`
- `keeps_batch_shell_copy_and_selected_count`
- `passes_structured_prompt_supplements_without_mutating_prompt`
- `preserves_existing_batch_confirm_payload_semantics`

**Step 2: 运行测试确认旧实现不满足新边界**

Run:

```bash
cd apps/workspace
pnpm exec vitest run src/domains/generation/components/BatchGenerationSettingsDialog.test.ts src/domains/generation/components/BatchGenerationSettingsDialog.render.test.tsx src/pages/ProjectOverview.test.tsx
```

Expected: 至少共享组件使用断言和结构化 supplement 断言 FAIL。

**Step 3: 改成薄 adapter**

- `BatchGenerationSettingsDialog` 只保留 `GenerationModalShell`、selected-count 文案、footer、confirm label 和 `onConfirm` adapter。
- 用共享 controller 驱动 `<GenerationSettingsForm />`；删除已经迁出的本地 state、picker、参数转换和 JSX。
- 保留 `BatchGenerationSettings` 对调用方有价值的 family/version/route 对象，必要时只在 confirm adapter 中从 routeId 回查，避免页面层承担 catalog 逻辑。
- 删除 `appendBatchPromptSupplements`；`buildBatchGenerationRequest` 将 `settings.promptSupplements` 原样映射到请求的 `promptSupplements`。
- 更新前端生成 request 类型；若 `apps/workspace/src/api/types/generation.ts` 是生成文件，使用仓库既有生成命令更新，不手改生成标记区。

**Step 4: 重跑回归测试**

Run:

```bash
cd apps/workspace
pnpm exec vitest run src/domains/generation/components/BatchGenerationSettingsDialog.test.ts src/domains/generation/components/BatchGenerationSettingsDialog.render.test.tsx src/pages/ProjectOverview.test.tsx
```

Expected: PASS，且旧批量测试无快照/交互回退。

**Step 5: 提交**

```bash
git add apps/workspace/src/domains/generation/components/BatchGenerationSettingsDialog.tsx apps/workspace/src/domains/generation/components/BatchGenerationSettingsDialog.test.ts apps/workspace/src/domains/generation/components/BatchGenerationSettingsDialog.render.test.tsx apps/workspace/src/pages/ProjectOverview.tsx apps/workspace/src/pages/ProjectOverview.test.tsx apps/workspace/src/domains/generation/api/generation.ts apps/workspace/src/api/types/generation.ts
git commit -m "refactor(generation): reuse shared form in batch dialog"
```

### Task 6: 新增 `generation_settings` 复合字段并接入 Agent 图片卡

**Files:**
- Modify: `packages/mcp/pkg/mcp/selection_types.go`
- Create: `packages/mcp/pkg/mcp/selection_test.go`
- Modify: `packages/mcp/pkg/mcp/tools.go`
- Modify: `packages/mcp/pkg/mcp/mcp_test.go`
- Modify: `services/server/internal/service/selection/types.go`
- Modify: `services/server/internal/service/selection/store.go`
- Modify: `services/server/internal/service/selection/store_test.go`
- Modify: `services/server/internal/app/mcp/selection_test.go`
- Modify: `apps/workspace/src/api/types/agent.ts`
- Create: `apps/workspace/src/domains/agent/components/timeline/AgentFormGenerationSettings.tsx`
- Create: `apps/workspace/src/domains/agent/components/timeline/AgentFormGenerationSettings.test.tsx`
- Modify: `apps/workspace/src/domains/agent/components/timeline/AgentFormCard.tsx`
- Modify: `apps/workspace/src/domains/agent/components/timeline/AgentFormCard.test.tsx`

**Step 1: 写服务端字段契约失败测试**

为 `kind=generation_plan` 定义两条明确分支：

- **新图片契约：** 恰好一个 required `generation_settings`，`kind=image`，不得和任何 `generation_params`、`images`、`prompt_optimization` 或通用字段混用。
- **兼容视频契约：** 本轮仍允许恰好一个 `generation_params(kind=video)`，外加至多一个 `images` 和一个 `prompt_optimization`。

拒绝：`generation_settings(kind=video/audio)`、重复 composite 字段、新旧字段混用、缺 kind、未知字段和无 generation 字段。验证 `generation_settings.default` 的完整对象 shape，包括 routeId、params、referenceAssetIds、promptSupplements、promptOptimization。

建议测试名：

- `TestSelectionGenerationPlanAcceptsSingleImageGenerationSettings`
- `TestSelectionGenerationPlanRejectsMixedGenerationContracts`
- `TestSelectionGenerationPlanKeepsLegacyVideoContract`
- `TestSelectionGenerationPlanRejectsVideoGenerationSettingsForNow`
- `TestSelectionGenerationSettingsValidatesNestedValue`

**Step 2: 写前端失败测试**

要求：

- `AgentFormGenerationSettings` 是共享表单的薄 adapter；区块、顺序、校验和批量弹窗相同。
- field default/任务 references 优先于已保存偏好；随后用户编辑保持不变。
- submit 只发送 `{[fieldId]: GenerationSettingsValue}` 一个字段，包含 route/params/references/supplements/optimization。
- catalog/prompt packs 未 hydrate、上传进行中或共享值 invalid 时禁用提交。
- 卡片上没有独立 `stylePresets`/通用“视觉风格”控件，但动态“风格”提示词包和 route 的 `style` 参数仍正常显示。
- 历史 transcript 的 `generation_params`、`images`、`prompt_optimization` 仍可渲染和摘要；保留三个旧组件，只停止新图片流程生成这些字段。

建议测试名：

- `renders_the_exact_shared_image_form`
- `hydrates_task_defaults_over_saved_preferences`
- `submits_all_generation_settings_as_one_value`
- `disables_submit_until_shared_form_is_ready_and_valid`
- `does_not_render_a_standalone_style_control`
- `keeps_legacy_generation_fields_readable`

**Step 3: 运行测试确认失败**

Run:

```bash
cd services/server && go test ./internal/service/selection ./internal/app/mcp -run 'Generation(Settings|Plan)' -count=1
cd packages/mcp && go test ./pkg/mcp -run 'Generation(Settings|Plan)' -count=1
cd apps/workspace && pnpm exec vitest run src/domains/agent/components/timeline/AgentFormGenerationSettings.test.tsx src/domains/agent/components/timeline/AgentFormCard.test.tsx
```

Expected: FAIL，因为新 field type、嵌套 validator 和前端 renderer 尚不存在。

**Step 4: 实现新契约**

- 新增 `FieldTypeGenerationSettings = "generation_settings"`，注释和 JSON schema 明确这是 image 完整设置表单，而不是任意对象。
- 在 `validateGenerationPlanFields` 中先判定新/旧契约，再进入 field value validation；新旧字段不得混合。
- 为 composite value 写逐层 validation/normalization：trim routeId/label，params 必须为 object，referenceAssetIds 必须为去重字符串数组，supplements 必须为 prompt 非空的对象数组，optimization 必须含布尔 enabled，开启时 routeId/referencePrompt 必填。
- `AgentFormField.type` 增加 `generation_settings`；`AgentFormCard` 为它渲染新 adapter，并通过 `onBusyChange/onValidityChange` 控制提交。
- `AgentFormGenerationSettings` 使用 Task 4 的 hook/view，不拥有第二套状态或控件；提交前调用共享 submit normalizer。
- `formatFormValue` 使用共享 formatter 展示已确认摘要；旧 field renderer 分支保持只读/历史兼容。

**Step 5: 重跑定向测试**

Run:

```bash
cd services/server && go test -race ./internal/service/selection ./internal/app/mcp
cd packages/mcp && go test -race ./pkg/mcp
cd apps/workspace && pnpm exec vitest run src/domains/agent/components/timeline/AgentFormGenerationSettings.test.tsx src/domains/agent/components/timeline/AgentFormCard.test.tsx
```

Expected: PASS。

**Step 6: 提交**

```bash
git add packages/mcp/pkg/mcp/selection_types.go packages/mcp/pkg/mcp/selection_test.go packages/mcp/pkg/mcp/tools.go packages/mcp/pkg/mcp/mcp_test.go services/server/internal/service/selection/types.go services/server/internal/service/selection/store.go services/server/internal/service/selection/store_test.go services/server/internal/app/mcp/selection_test.go apps/workspace/src/api/types/agent.ts apps/workspace/src/domains/agent/components/timeline/AgentFormGenerationSettings.tsx apps/workspace/src/domains/agent/components/timeline/AgentFormGenerationSettings.test.tsx apps/workspace/src/domains/agent/components/timeline/AgentFormCard.tsx apps/workspace/src/domains/agent/components/timeline/AgentFormCard.test.tsx
git commit -m "feat(agent): add unified image generation settings form"
```

### Task 7: 将完整设置纳入同一次用户确认授权

**Files:**
- Modify: `services/server/internal/app/mcp/generation_confirmation.go`
- Create: `services/server/internal/app/mcp/generation_confirmation_test.go`
- Modify: `services/server/internal/app/mcp/generation.go`
- Modify: `services/server/internal/app/mcp/generation_test.go`
- Modify: `packages/mcp/pkg/mcp/generation_types.go`
- Modify: `packages/mcp/pkg/mcp/mcp_test.go`

**Step 1: 写失败测试**

以表驱动测试证明：

- 只有 `submitted` 且 runId/sessionId/projectId 匹配的 selection 能授权生成；pending、timeout、cancelled、expired 均拒绝。
- image 必须读取新 `generation_settings`；video 继续读取旧三字段契约。
- 传入 routeId、params、referenceAssetIds、promptSupplements、promptOptimization 任一项与已提交值不同都拒绝。
- URL/binding references 与 family/version/provider/model override 继续拒绝，不能绕过用户选择。
- supplement 比较使用规范化后的顺序与内容；不能在确认后替换包名称/prompt 或额外追加。
- 一次合法的图片请求使用同一 selectionId，生成服务实际收到的值与用户提交值完全一致。

建议测试名：

- `TestAuthorizeGenerationAcceptsSubmittedImageGenerationSettings`
- `TestAuthorizeGenerationRejectsEachGenerationSettingsMismatch`
- `TestAuthorizeGenerationRejectsUnresolvedSelectionStates`
- `TestAuthorizeGenerationKeepsLegacyVideoPlanCompatibility`
- `TestGenerateMediaPassesConfirmedSettingsUnchanged`

**Step 2: 运行测试确认失败**

Run:

```bash
cd services/server
go test ./internal/app/mcp -run 'AuthorizeGeneration|GenerateMediaPassesConfirmedSettings' -count=1
```

Expected: FAIL，旧 parser 只认识 `generation_params/images/prompt_optimization`，也未比较 supplements。

**Step 3: 实现双协议 parser 与精确比较**

- `submittedGenerationPlanFromRecord` 根据字段契约解析新 image composite 或 legacy video 字段，产出同一个内部 `submittedGenerationPlan`。
- 内部 plan 明确持有 kind、routeId、params、referenceAssetIDs、promptSupplements、promptOptimization，不再让授权函数到原始 map 中临时取值。
- 对上述每个字段分别 canonicalize 后比较；错误文案指出不一致的字段，但不泄漏敏感 prompt 全文。
- `generate_media` 只接受经确认的 route；保留现有禁止 model override 和 URL/binding reference 的约束。
- 批量输入沿用现有每 item 授权语义；每个 image item 都必须对应有效 confirmation，不能用一个部分匹配值绕过。

**Step 4: 重跑测试**

Run:

```bash
cd services/server
go test -race ./internal/app/mcp
cd ../.. && cd packages/mcp && go test -race ./...
```

Expected: PASS。

**Step 5: 提交**

```bash
git add services/server/internal/app/mcp/generation_confirmation.go services/server/internal/app/mcp/generation_confirmation_test.go services/server/internal/app/mcp/generation.go services/server/internal/app/mcp/generation_test.go packages/mcp/pkg/mcp/generation_types.go packages/mcp/pkg/mcp/mcp_test.go
git commit -m "fix(agent): authorize complete confirmed generation settings"
```

### Task 8: 更新 Agent Skill、工具说明与 prompt 快照

**Files:**
- Modify: `packages/instructions/pkg/pack/builtin/assets/skills/image-generation.skill.md`
- Modify: `packages/instructions/pkg/pack/builtin/assets/skills/video-generation.skill.md`
- Modify: `packages/instructions/pkg/official/assets/instructions/TOOLS.md`
- Modify: `packages/instructions/pkg/pack/builtin/builtin_test.go`
- Modify: `packages/instructions/pkg/official/official_test.go`
- Modify: `packages/mcp/pkg/mcp/tools.go`
- Modify: `packages/mcp/pkg/mcp/selection_types.go`
- Modify: `packages/mcp/pkg/mcp/mcp_test.go`
- Modify: `services/server/internal/service/prompt/testdata/no_project.golden`
- Modify: `services/server/internal/service/prompt/testdata/project_no_document.golden`
- Modify: `services/server/internal/service/prompt/testdata/document_no_scoped_edit.golden`
- Modify: `services/server/internal/service/prompt/testdata/scoped_edit_active.golden`

**Step 1: 写/更新说明快照测试**

断言图片 Skill 的唯一确认流程为：

1. 先准备业务 prompt 和已有参考资产；
2. `ask_user_form(kind=generation_plan)` 只创建一个 required `generation_settings(kind=image)`；
3. 对 pending/timeout 持续 await 同一个 selectionId；
4. 仅在 `submitted` 后，把返回的 route/params/references/supplements/optimization 原样映射到 `generate_media`；
5. cancel/expired 停止，不能自动继续。

同时断言：不出现独立风格卡、不读取 `stylePresets`、不在客户端/Agent 拼 supplement、视频继续使用 legacy video contract 且同样无独立风格步骤。

**Step 2: 运行测试确认失败**

Run:

```bash
cd packages/instructions && go test ./pkg/pack/builtin ./pkg/official -count=1
cd packages/mcp && go test ./pkg/mcp -count=1
cd services/server && go test ./internal/service/prompt -run TestBuildACPPromptSnapshots -count=1
```

Expected: FAIL，旧说明仍描述分散字段，golden 与新契约不一致。

**Step 3: 更新文档与快照**

- 图片 Skill 使用新 composite 字段，并明确“表单关闭/await 超时不等于提交”；只有 `status=submitted` 能继续。
- 视频 Skill 写清本轮仍用 `generation_params(kind=video)` + 可选旧字段，同时禁止独立风格选择。
- `TOOLS.md`、MCP tool description 和 JSON schema 统一描述新图片/旧视频两条契约，避免模型自行创造通用字段。
- 先人工检查 prompt 变化，再用既有命令更新 golden：

```bash
cd services/server
UPDATE_PROMPT_GOLDENS=1 go test ./internal/service/prompt -run TestBuildACPPromptSnapshots -count=1
git diff -- internal/service/prompt/testdata
```

只接受本计划对应的契约文本变化；若混入无关 prompt 改动，停止并追查来源。

**Step 4: 重跑测试**

Run:

```bash
cd packages/instructions && go test -race ./...
cd packages/mcp && go test -race ./...
cd services/server && go test -race ./internal/service/prompt ./internal/app/mcp
```

Expected: PASS。

**Step 5: 提交**

```bash
git add packages/instructions/pkg/pack/builtin/assets/skills/image-generation.skill.md packages/instructions/pkg/pack/builtin/assets/skills/video-generation.skill.md packages/instructions/pkg/official/assets/instructions/TOOLS.md packages/instructions/pkg/pack/builtin/builtin_test.go packages/instructions/pkg/official/official_test.go packages/mcp/pkg/mcp/tools.go packages/mcp/pkg/mcp/selection_types.go packages/mcp/pkg/mcp/mcp_test.go services/server/internal/service/prompt/testdata/no_project.golden services/server/internal/service/prompt/testdata/project_no_document.golden services/server/internal/service/prompt/testdata/document_no_scoped_edit.golden services/server/internal/service/prompt/testdata/scoped_edit_active.golden
git commit -m "docs(agent): teach unified image generation confirmation"
```

### Task 9: 完整回归、人工验收与显式收尾

**Files:**
- Verify only; fix failures in the owning files from Tasks 1–8.

**Step 1: 运行前端全量质量门禁**

Run:

```bash
cd apps/workspace
pnpm test
pnpm lint
pnpm format
pnpm build
```

Expected: 全部退出码 0；`pnpm build` 完成 TypeScript typecheck 与 Vite build。

**Step 2: 运行 Go 全量质量门禁**

Run:

```bash
cd packages/instructions && go test -race ./...
cd ../mcp && go test -race ./...
cd ../../services/server && task check
```

Expected: 全部退出码 0；`task check` 包含 gofmt、vet、lint 和 race tests。若 Taskfile 的定义发生变化，再显式补跑 `task test` 与 `task build`。

**Step 3: 浏览器人工验收**

在本地 workspace + server 中逐项确认：

- 从 Agent 发起图片生成：直接看到与概览批量生成相同的五个设置区块，无额外风格步骤。
- 模型、route schema 参数、参考图、补充提示词、优化提示词均可编辑；route schema 的 `style` 参数不被过滤。
- 新增一个任意分类提示词包后立刻可见；删除当前已选包后状态被清理并阻止无效提交。
- 取消/关闭表单后 Agent 不继续生成；await 心跳 timeout 后仍停留在同一 selection。
- 提交后只生成一次，supplement 只追加一次，优化模型收到追加后的 prompt。
- 概览批量生图行为、默认值恢复、选中数量和 footer 无回退。
- Agent 视频流程没有独立风格步骤，且现有视频参数确认与生成仍可用。
- 刷新后历史分散字段卡片仍可阅读，新的图片卡显示完整设置摘要。

**Step 4: 检查 diff 与测试污染**

Run:

```bash
cd /Users/caorushizi/Workspace/Projects/mediago-dev/mediago-drama
git diff --check
git status --short
git diff --stat
```

Expected: 无 whitespace 错误；没有测试上传文件、生成产物、localStorage dump、秘密或与本计划无关的文件。

**Step 5: 只提交必要的收尾修复**

如果全量门禁暴露跨任务修复，按文件显式暂存：

```bash
git add <本次收尾实际修改的文件>
git commit -m "test(generation): cover unified settings flow"
```

若没有额外改动，不创建空提交。

---

## 验收标准

- 新图片 Agent 流程没有 standalone style selection，且只有用户显式提交统一设置后才生成。
- Agent 图片卡与批量弹窗共用 controller、表单组件、route 参数解析、默认值、validation 和 submit normalization；不存在第二套复制实现。
- 表单完整包含模型、全部 route 参数、参考图、补充提示词、优化提示词，并保持批量表单现有顺序。
- 用户自定义提示词包（包括名为“风格”的分类）仍可增删；route schema 的 `style` 字段仍可用。
- supplements 是结构化请求字段，在服务端统一去重/追加，并先于 prompt optimization 应用。
- 服务端把用户确认的 route、params、references、supplements、optimization 全部纳入同 run 授权，任何篡改都拒绝。
- 关闭、取消、pending、timeout、expired 都不会自动继续；仅 `submitted` 可生成。
- 概览批量生成无行为回退；历史 Agent 卡和本轮 legacy 视频流程兼容。
- 前端与 Go 全量质量门禁全部通过。

## 明确不做

- 不删除提示词库中的“风格”分类，也不禁止用户创建同名分类。
- 不过滤模型 route schema 中名为 `style` 的业务参数。
- 不删除 generation HTTP/service 目录中的 style preset 数据；只停止 Agent MCP 暴露和使用旧流程。
- 本轮不把视频 Agent UI 切到 `generation_settings`，只移除其独立通用风格步骤并保留后续迁移接口。
- 不重设计批量弹窗的外壳、文案、选中数量和 footer。
- 不修改 text/audio 生成确认流程。
