# 聚合平台(Model Platform)接入方案

> 本文为完整设计规格,供实现与审查使用,自包含、无需额外上下文。
> 代码引用格式:`文件路径:行号`。

---

## 0. 摘要(TL;DR)

引入"聚合平台"概念:`mediago`(第一方)、`openrouter`、`dmxapi`,三者均为 OpenAI 兼容端点。**配置某平台的一把 API Key 后,用户在"生成"和"智能体"两个模型选择器里都能选用该平台支持的模型**,统一用这把 Key 认证,并与用户单独配置的官方 provider 并存。

打包时新增数组变量 `MODEL_PLATFORM` 决定本版本**提供哪些平台**(白标):默认 `mediago`,也可 `mediago,dmxapi,openrouter`。`AGENT`(引擎:codex/opencode)保持不变。

实现是**加法**:不改动现有 codex/opencode 行为、生成路由过滤、runtime 既有 provider、`AGENT` 语义。

---

## 1. 背景:系统里有两套彼此独立的模型子系统

理解本方案的前提,是先分清这两套系统——它们是**两条独立的路**:

| | 生成子系统(图像/视频/文本) | 智能体子系统(ACP 编码/写作代理) |
|---|---|---|
| 用户入口 | 生成页的模型选择器 | 智能体对话的模型选择器 |
| 执行路径 | 直连各 provider 的 API,经 `packages/core/pkg/generation/runtime/provider.go` 的适配器 | 由 ACP 引擎进程(codex-acp / opencode)驱动 |
| 与 opencode 的关系 | **无关**,生成不经过 opencode | opencode 就是智能体引擎本身 |
| "有哪些模型可选" | 由"哪些 provider 的 Key 已配置"决定 | 由引擎 + 已配置 Key 的模型模板决定 |

### 1.1 现状:生成子系统

- provider(= Key 槽,存 `api_keys` 表,见 `services/server/internal/repository/api_key_store.go`):聚合类 `dmx`、`openrouter`;官方类 `openai`、`google`、`minimax`、`deepseek`、`volcengine`;本地 `jimeng`。定义见 `packages/core/pkg/generation/credentials.go`、`packages/core/pkg/generation/providers.go`。
- 目录里每个逻辑模型对每个能服务它的 provider 各有一条 route,route 带 `Provider` 与 `AuthKeys`(所需 Key 槽)。构造见 `packages/core/pkg/generation/catalog_builders.go`(`dmxRoute:47` / `openRouterRoute:101` / `officialRoute`)。
- "已配置"判定:`GenerationRouteConfigured(route, hasAPIKey)`(`services/server/internal/service/generation/generation_helpers.go:389`)——route 的所有 `AuthKeys` 都有非空 Key 才算已配置。
- 前端据此过滤:`isConfiguredRoute`(`apps/workspace/src/domains/generation/hooks/generationCatalog.ts:31`)。**结论:填了哪个 provider 的 Key,生成选择器就出现哪个 provider 的模型。**
- 运行时按 `route.Provider` 建适配器并取 Key:`runtime/provider.go:154 providerForRoute`;`dmx`/`openrouter` 适配器均支持可配置 `BaseURL`。

### 1.2 现状:智能体子系统

- 打包期 `AGENT` 变量(`Taskfile.yml:6`,默认 `opencode`)决定绑定并运行哪个 ACP 引擎二进制:`AGENT` → env `MEDIAGO_AGENT_ID` → `services/server/cmd/mediago-server/main.go:237 applyEnvOverrides` → `config.Agent.ID` → `services/server/internal/app/wire.go:47`。仅 `codex`、`opencode` 两个合法值(它们是真实二进制)。
- 引擎差异:`codex` 只用自家(GPT);`opencode` 多 provider,模型清单来自配置。
- opencode 的模型清单在会话启动时生成:`PrepareOpenCodeRuntimeConfig`(`services/server/internal/service/settings/agent_model_profiles.go:303`)把"已配置 Key 的模型模板"渲染成 `opencode.json` 并注入 Key 环境变量;挂载点在 `wire.go:89`。
- **该注入只对 opencode 生效**:`prepareProcessConfig` 对非 opencode 命令直接返回空(`services/server/internal/service/acp/acp_runner.go:296`)。**即 codex 引擎拿不到这些平台 Key,平台的智能体模型在 codex 下不可用。**
- 现有模型模板:`AgentModelProfileTemplates()`(`agent_model_profiles.go:487`,现有 `openrouter`/`minimax`/`deepseek`,均已内置 base_url + 模型);模板→Key 槽映射:`officialAgentModelProfileSpecs()`(`agent_model_profiles.go:550`)。只要对应 Key 槽有值,对应模型就自动进 `opencode.json`(`officialAgentRuntimeProfiles:328`),无需手动建 profile。

---

## 2. 目标

1. 新增聚合平台 `mediago`(第一方)、`openrouter`、`dmxapi`,均 OpenAI 兼容。
2. 配置某平台 Key 后,该平台模型在**生成**与**智能体**两个选择器都可选,统一用这把 Key。
3. 平台与用户单独配置的官方 provider **并存**;平台的意义是"用户不必再逐个配官方 Key"。
4. 打包时通过 `MODEL_PLATFORM`(数组)决定本版本提供哪些平台(白标),以便产出"默认 mediago 版""备用 dmxapi/openrouter 版"。

---

## 3. 核心概念:聚合平台(Platform)

一个平台 = 一个 OpenAI 兼容端点 + 一把 Key,同时供给两套子系统:

```
Platform {
  id          "mediago" | "openrouter" | "dmxapi"
  kind        "unified"(mediago,第一方) | "custom"(openrouter/dmxapi,第三方)
  label       展示名
  baseURL     OpenAI 兼容端点(烘焙常量,用户不填)
  apiKeyName  Key 槽名:mediago(新) / openrouter(已有) / dmx(已有)
  generation  该平台的生成 provider id + routes
  agent       该平台的 opencode 模型模板
}
```

- `mediago` 为第一方,展示为"统一接口";`openrouter`/`dmxapi` 为第三方,展示为"自定义接口"。
- **一个平台一把 Key,两套子系统共用**。

---

## 4. 数据流:一把 Key,两条路

```
                       ┌───────────────────────────────────────────┐
   用户在 API 密钥页    │  平台 Key(api_keys 槽: mediago/openrouter/dmx) │
   顶部粘贴平台 Key ──▶ └───────────────┬───────────────┬───────────┘
                                       │               │
                     ┌─────────────────▼──┐        ┌───▼──────────────────────┐
                     │ 生成子系统          │        │ 智能体子系统(仅 opencode) │
                     │ 平台=生成 provider  │        │ 平台=opencode 模型模板     │
                     │ Key 已配置→routes   │        │ Key 已配置→opencode.json  │
                     │ 出现在生成选择器     │        │ 模型出现在智能体选择器      │
                     └─────────────────────┘        └───────────────────────────┘
```

- 两侧都靠"该平台 Key 是否已配置"自动响应。
- 智能体侧额外要求 `AGENT=opencode`(见 §5.4 不对称)。

---

## 5. 打包期变量 `MODEL_PLATFORM`

### 5.1 语义

- 决定**本打包版本在 API 密钥页提供哪些平台卡**。
- 值为平台 id 数组;env 只能是字符串,故用**逗号分隔**:`MODEL_PLATFORM=mediago` 或 `MODEL_PLATFORM=mediago,dmxapi,openrouter`。
- 默认建议 `mediago`。空 = 不展示平台卡(完全回退现状)。
- **列表顺序 = 展示顺序 / 智能体默认模型优先级**(`officialAgentRuntimeProfiles` 中第一个被纳入者成为默认,`agent_model_profiles.go:349`)。

### 5.2 穿透链路(镜像现有 `AGENT` → `MEDIAGO_AGENT_ID`)

1. `Taskfile.yml` vars 增 `MODEL_PLATFORM: '{{.MODEL_PLATFORM | default "mediago"}}'`。
2. 在设置 `MEDIAGO_AGENT_ID` 的每个 task 的 `env:` 并列加 `MEDIAGO_MODEL_PLATFORM: "{{.MODEL_PLATFORM}}"`(`Taskfile.yml` build:38、build:electron:64、build:electron:target:89、dev:156、dev:server:187)。
3. Electron 打包:`apps/workspace/scripts/stage-electron.ts` 透传;`apps/workspace/electron/src/sidecar.ts` 拉起 server 时注入 `MEDIAGO_MODEL_PLATFORM`。
4. Server 读取:`services/server/cmd/mediago-server/main.go:applyEnvOverrides` 增 `MEDIAGO_MODEL_PLATFORM` → `config`(新增 `ModelPlatforms []string`),再传给 settings 服务。

> 命名注意:**不能叫 `PLATFORM`** —— 该名在 Taskfile 已表示 OS 目标(`Taskfile.yml:83` 的 `darwin-arm64`/`windows-x64`)。

### 5.3 打包示例

| 目标包 | 命令(节选) | 引擎 | 应用展示 |
|---|---|---|---|
| 默认 mediago | `MODEL_PLATFORM=mediago`(AGENT 默认 opencode) | opencode | 统一接口: mediago |
| 备用 dmxapi | `MODEL_PLATFORM=dmxapi` | opencode | 自定义接口: dmxapi |
| 多平台可选 | `MODEL_PLATFORM=mediago,openrouter,dmxapi` | opencode | 统一接口 + 自定义接口三张卡 |
| 通用(用户自配) | 不设 | opencode | 现状 |
| codex | `AGENT=codex` | codex-acp | 现状(GPT) |

### 5.4 与 `AGENT` 的关系 / 一个不对称(重要)

- `AGENT`(引擎)与 `MODEL_PLATFORM`(平台)是**两个正交轴**,`AGENT` 保持不变。
- **平台的生成模型**在 codex/opencode 下都能用(生成不经引擎)。
- **平台的智能体模型只在 `AGENT=opencode` 下生效**(codex 引擎的 gate,`acp_runner.go:296`)。
- 因此:白标平台包应搭配 `AGENT=opencode`;否则智能体侧用不到该平台。UI 上建议提示。

---

## 6. API 密钥页布局(`apps/workspace/src/pages/Settings.tsx` 的 `APIKeysPanel`)

自上而下三段:

1. **「统一接口」模块**:`mediago` 卡(当 `MODEL_PLATFORM` 含 `mediago`)。粘贴 mediago Key。
2. **「自定义接口」模块**:`openrouter` / `dmxapi` 卡(当 `MODEL_PLATFORM` 含它们)。各粘各的 Key。
3. **官方供应商列表**(现有):OpenAI / Google Gemini / MiniMax / DeepSeek / Volcengine —— 与平台**并存**,用户仍可单独配置与选用。

- **去重**:`openrouter`、`dmx` 原本就在现有列表(聚合 provider),**上移**进「自定义接口」模块;官方列表只保留纯官方 provider。避免同一把 Key 显示两处。(纯前端重排,不动后端。)
- **Key 共享**:每个平台一个 Key 槽,生成侧与智能体侧共用;填一次两侧生效。保存/清除复用现有 `PUT/DELETE /api/v1/settings/api-keys/:provider`。
- 需要一个只读接口返回"本版本提供哪些平台"(基于 `MODEL_PLATFORM`),供前端渲染顶部两个模块,例如 `GET /api/v1/settings/model-platforms`。

---

## 7. 两侧接入实现(每个平台都要接两处)

### 7.1 生成侧(mediago 需新增;openrouter/dmx 已具备)

- 新增 provider 常量 `ProviderMediago = "mediago"`(`packages/core/pkg/generation/catalog_adapters.go`);`Providers()`(`providers.go`)登记为 aggregator。
- 新增 mediago routes:照 `openRouterRoute`(`catalog_builders.go:101`)为各族模型建 route,`Provider=mediago`、`AuthKeys=["mediago"]`,adapter 复用 OpenRouter 的 OpenAI 兼容适配器。
- runtime:`runtime.Config` 增 `MediagoBaseURL`(`runtime/provider.go:36`);`providerForRoute` 的 aggregator 分支加 `case ProviderMediago`;base_url 用烘焙常量。
- 效果:mediago Key 一填,其 routes 变 `configured`,出现在生成选择器,与官方 provider 并存。

### 7.2 智能体侧(mediago/dmxapi 需新增;openrouter 已具备)

- `AgentModelProfileTemplates()`(`agent_model_profiles.go:487`)新增 `mediago`、`dmxapi` 模板(base_url + 模型清单烘焙进模板)。
- `officialAgentModelProfileSpecs()`(`agent_model_profiles.go:550`)新增 `{mediago→mediago}`、`{dmxapi→dmx}`。
- 效果:平台 Key 一填且 `AGENT=opencode`,其模型自动进 `opencode.json`,出现在智能体选择器。

### 7.3 凭据槽

- `CredentialSpecs()`(`credentials.go`)新增 `mediago` 槽(label/placeholder/help);`openrouter`/`dmx` 已有。

---

## 8. base_url

**用户不需要填**。mediago 用烘焙常量(第一方端点,待提供);openrouter/dmx 用其已知默认。生成侧走 runtime 常量,智能体侧走模板内 base_url。

---

## 9. 边界与"不改动"

- **不改动**:codex/opencode 现有行为;生成"已配置"过滤与 runtime 既有 provider 解析;`AGENT` 语义;`PrepareOpenCodeRuntimeConfig` 对用户手建 profile 的既有逻辑。
- **新增(全部加法)**:`MODEL_PLATFORM` 变量及穿透;mediago 生成 provider + routes + runtime 分支;mediago/dmxapi 智能体模板 + 映射;mediago 凭据槽;API 密钥页两个平台模块 + openrouter/dmx 上移 + 只读平台接口。
- **能力缺口**:平台不覆盖的族(如某平台无 TTS/语音)在该平台下不可用;用户可回退官方 provider。
- **回退**:`MODEL_PLATFORM` 空即完全等同现状。

---

## 10. 分期

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 | `MODEL_PLATFORM` 穿透 + config;`mediago` 凭据槽;API 密钥页两个平台模块(读 `MODEL_PLATFORM`)+ openrouter/dmx 上移 + 只读平台接口 | 按变量打包后顶部正确展示平台卡;能粘贴/保存平台 Key |
| P1 | 智能体侧:mediago/dmxapi 模板 + spec 映射 | 配好平台 Key 且 `AGENT=opencode` 后,智能体选择器出现平台模型 |
| P2 | 生成侧:mediago provider + routes + runtime 分支 + 烘焙 base_url | 配好平台 Key 后,生成选择器出现平台模型并能成功生成 |

质量门:`task check`(gofmt+vet+lint)、`task test`(go test -race + 前端 lint/format/build)。

---

## 11. 给 Codex 的重点审查问题

1. "配了平台两侧都能用"需要在生成与智能体**各接入一次**(§7)。这个双接入是否有更收敛的做法,还是本就该分两处?
2. `MODEL_PLATFORM` 只控制"平台卡是否展示",两侧各自按"Key 是否配置"响应。分工是否清晰?是否需要 `MODEL_PLATFORM` 同时 gate 生成选择器(白标时隐藏未列出的平台/官方)?当前设计是**并存不隐藏**。
3. 平台 Key 单槽供两侧共用(生成 + 智能体),是否有冲突或语义歧义?
4. openrouter/dmx 从现有列表上移进「自定义接口」模块,是否只影响前端展示、不动其作为生成 provider 的既有逻辑?
5. `AGENT=opencode` 才能让平台的智能体模型生效、codex 版本下平台 Key 只对生成有效(§5.4)——这个不对称是否需要在 UI 明确提示?
6. mediago 生成侧复用 OpenRouter(OpenAI 兼容)适配器是否成立?若 mediago 的 image/video 响应形态不同,是否需独立适配器?
7. `MODEL_PLATFORM` 用逗号分隔 env 传递、空=现状、顺序=默认优先级 —— 是否合理?命名 `MODEL_PLATFORM`/`MEDIAGO_MODEL_PLATFORM` 与既有 `PLATFORM`(OS 目标)是否彻底无歧义?
