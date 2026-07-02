# 设置 · API 接口页优化规划（开源版，无充值元素）

目标：让「统一接口」（MediaGo）成为页面上显而易见的默认路径，提高其配置率和使用率。转化（注册/充值）全部发生在官网侧，**应用内不出现任何充值、余额、付费相关的元素**——本项目在 GitHub 开源，App 只负责把用户顺畅地送到 API Key 页面并把 Key 收回来。

配置流程保持现状：跳转官网 API Key 页 → 用户手动复制 → 回 App 粘贴 → 一键配置。

现状代码入口：

- 页面：`apps/workspace/src/pages/Settings.tsx`（`APIKeysPanel`，三段式：统一接口 / 自定义接口 / 官方供应商）
- 数据：`apps/workspace/src/domains/settings/api/settings.ts`（`getAPIKeys` + `getModelPlatforms`，platform 已带 `kind: unified|custom` 和 `modelGroups`）

---

## 一、页面信息架构

```
┌─ MediaGo（Hero 卡，占满宽度，状态驱动）───────────────────┐
│  未配置态：价值点 + [获取 API Key ↗]（主按钮，跳官网）      │
│           + Key 粘贴框 + [一键配置]                        │
│  已配置态：已连接状态 + 支持模型 chips                     │
│           + 粘贴新 Key 替换 / 清除                         │
└──────────────────────────────────────────────────────────┘

┌─ 会员 CLI 接入（常驻可见，次级视觉权重）───────────────────┐
│  即梦 CLI：「已开通即梦高级会员？可直接登录账号接入，       │
│            无需 API Key」 + [登录]（复用现有 OAuth 流）    │
│  （预留扩展位：小云雀 CLI、LibTV CLI）                     │
└──────────────────────────────────────────────────────────┘

▸ 其他接入方式（默认折叠的手风琴）
   ├─ 自定义接口（feature flag 控制，打包可整段裁掉）
   └─ 官方供应商（保留现有行式列表 + 编辑弹窗交互）
```

关键决策：

1. **整页只有一个 primary 视觉焦点**，属于 MediaGo 卡。未配置时主按钮是「获取 API Key」（跳官网），粘贴框和一键配置紧随其下；其他 section 的按钮全部 ghost/outline 或 secondary。
2. **CLI 接入单独成组、不折叠**。很多用户已经买了即梦会员，这是零边际成本的接入路径，必须让他们一眼看到"高级会员可以直接登录使用"。视觉权重低于 MediaGo 卡（普通边框、无推荐标），但常驻可见。即梦现有的 device-code 登录流（`beginProviderLogin`/`completeProviderLogin`、`APIKeyProviderRow` 的登录/确认交互）原样复用，只是从「官方供应商」组里搬出来。
3. **「其他接入方式」默认折叠**。备选路径不删除，但需要一次主动展开。例外：检测到已有 `configured` 的折叠组内 provider 时该组默认展开，避免老用户以为配置丢了。
4. **自定义接口加独立 feature flag**（如 `customProvidersEnabled`，照现有 `jianyingDraftSettingsEnabled` 的写法），上线不打包时整段消失、不留空位。
5. **官方供应商组加一句定位文案**：「已有各平台官方账号时使用；否则推荐 MediaGo，一个 Key 覆盖全部模型」。

## 二、MediaGo Hero 卡设计

### 未配置态

- 价值点用真实数据说话：从 `modelGroups` 渲染支持的模型 chips（GPT-Image、Seedream、Seedance、MiniMax…），配一句「一个 Key 通用图像 / 视频 / 音频 / 文本模型」。不写营销空话。
- 主按钮 **「获取 API Key ↗」**：`openExternalUrl` 打开官网 API Keys 页。
- 按钮下方给一行三步引导文案：「注册 / 登录 → 创建 API Key → 复制回来粘贴到下方」，消除跨端断链时"回来该干嘛"的迷茫。
- 粘贴框 + 一键配置沿用现有 `MediagoCredentialPanel` 逻辑（含长度提示 helper text）。

### 已配置态

- 顶部显示明确的成功状态：「已连接」+ 掩码 Key（现有 `MaskedAPIKeyInput` 逻辑保留）。
- 继续展示支持模型 chips——让用户配置完能感知"我现在能用什么"。
- 次级操作：粘贴新 Key 替换、清除当前 Key（现状保留）。
- 不显示余额、用量、充值入口。用量查看走已有的「用量与账单」tab，那是本地统计，与付费无关，保持不动。

### 工程修正项

- `mediagoAPIKeyURL` 目前硬编码 `http://localhost:4321/account#apiKeys`（`Settings.tsx:63`），改为构建时环境变量（`VITE_MEDIAGO_APIKEY_URL` 之类）+ 合理的生产默认值。

## 二·五、会员 CLI 接入组设计

定位：面向"已经在为即梦等平台付费"的用户，提供零额外成本的接入路径。与 MediaGo 不冲突——文案上明确分工：MediaGo 是全模型通用 Key，CLI 接入是"你已有的会员直接用起来"。

- **卡片内容**（每个 CLI provider 一行/一卡）：
  - 平台名 + 一句会员提示：「即梦高级会员可直接登录账号接入，无需 API Key」
  - 登录状态（未登录 / 等待浏览器授权 / 已登录）+ 登录按钮，完整复用现有即梦 OAuth 交互（验证码展示、打开授权页、确认、轮询）
  - 已登录态显示「本地会话已记录」+ 重新登录 / 清除
- **provider 归组方式**：
  - 短期：前端常量 `cliProviderIDs = ["jimeng"]`，从 `officialProviders` 里筛出来单独渲染
  - 长期：后端 `ModelPlatform.kind` 增加 `"cli"`，前端按 kind 分组（与现有 unified/custom 一致），新增小云雀、LibTV 时只需后端下发，前端零改动
- **扩展预留**：小云雀 CLI、LibTV CLI 未上线前不显示占位卡（不做"敬请期待"）；上线即通过 kind 下发自动出现。组描述文案可提前写成通用的「使用各平台会员账号直接登录接入」。

## 三、页面之外的使用率抓手（均不涉及付费）

1. **空态引导**：用户一个 Key 都没配就打开生成弹窗时，空态提示直接深链到设置页 API 密钥 tab 的 MediaGo 卡，而不是让用户自己找。
2. **路由默认偏好**：已配置 MediaGo 时，生成弹窗同模型多供应商的情况下默认选 MediaGo 路由——这是"使用率"最直接的抓手。
3. **Key 无效的报错清晰化**：MediaGo 路由返回 401 时，错误提示写明「API Key 无效或已过期，请到设置中更新」并带跳转，不引导充值。

## 四、实施顺序

**Phase 1 — 页面重排（纯前端）**
- MediaGo Hero 卡改版（两种状态 + 模型 chips + 三步引导文案）
- 即梦从官方供应商组提出，新建「会员 CLI 接入」组（前端常量 `cliProviderIDs` 筛选，复用现有 OAuth 交互）
- 自定义接口 + 官方供应商折叠为「其他接入方式」，自定义接口加 feature flag
- `mediagoAPIKeyURL` 配置化
- 更新 `Settings.test.tsx` 对应用例

**Phase 1.5 — CLI 分组后端化（可与 Phase 2 并行）**
- `ModelPlatform.kind` 增加 `"cli"`，即梦归入；前端改为按 kind 分组
- 为小云雀 CLI、LibTV CLI 的接入留好数据通道（上线即下发即显示）

**Phase 2 — 使用率抓手（前端 + 少量生成域改动）**
- 生成弹窗空态引导深链
- 路由默认偏好 MediaGo
- 401 错误文案与跳转

## 五、开放问题

1. 折叠对老用户的影响：靠"已配置第三方 Key 则默认展开"缓解。
2. `modelGroups` 数据是否已在生产后端下发完整（决定 chips 是否有内容兜底：为空则只显示文案不显示 chips）。
