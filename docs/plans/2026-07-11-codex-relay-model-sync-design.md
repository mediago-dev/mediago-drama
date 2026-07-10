# Codex 中转模型同步设计

## 目标

让软件在 Agent 页面展示 Codex 中转 `/v1/models` 返回的模型（包括 GPT-5.6）。中转设置只管理 Base URL、API Key 和启用状态，不承担模型选择。

## 方案

后端继续使用现有 `POST /api/v1/settings/codex-relay/check` 作为鉴权和连通性探测入口，但在成功响应中增加 `models` 字段。服务只解析 OpenAI 兼容的 `data[].id`，去除空值和重复项并保留上游顺序；对于当前已经视为可用的 `404`/`405` 响应，仍返回成功但模型列表为空。响应体设置有限大小，避免无界读取。

Agent 运行配置探测时复用中转检查能力取得上游模型目录。服务端先把上游返回的模型追加为 ACP 原始模型选项，再以该目录作为允许列表，过滤 ACP 的其他内置模型。合并和过滤完成后，最终选项再按中转目录的排序统一重排，避免 ACP 内置模型始终排在后发现的新版本之前。这样 Agent 页面只显示当前中转实际提供的模型，并保持全局版本顺序。

模型目录在服务端统一排序：GPT 模型按主版本和次版本降序；同版本按基础版、`sol`、`terra`、`luna`、`pro`、`codex`、`mini`、`nano` 排列；无法识别版本的模型放在最后并按名称排序。排序只改变展示次序，不改写上游模型 ID。

用户在 Agent 页面选择模型后，现有请求继续通过 ACP `set_session_config_option` 发送模型字符串。官方 `codex-acp 1.1.2` 使用 Codex 0.144.0 App Server，既接受上游模型 ID，也内置 GPT-5.6 metadata。实际运行已经带有用户选择的模型时不重复请求目录，避免给每次 Agent 调用增加一次探测延迟。

## 错误处理与兼容性

- 上游返回成功但模型 JSON 不可解析时，连通性仍成功；Agent 页面回退到 ACP 原有模型目录。
- 鉴权失败和无效 API Key 保持原有错误行为。
- 旧 Profile 的内部 `model` 字段继续保留，仅作为 Codex 启动兼容默认值，不在中转设置页暴露。
- Agent 既有的模型选择持久化逻辑保持不变。

## 测试

- Go：验证 `/v1/models` 的 ID 提取、去重和响应大小边界；保留现有鉴权测试。
- Go：验证发现的 GPT-5.6 模型会追加并限制 Agent 模型选项，且不影响 OpenCode 现有 Provider 过滤。
- React：验证中转设置页仍不展示模型选择。
- 质量门：服务端相关 Go 测试、前端目标 Vitest、前端 lint/format/build，以及服务端 `task check`/`task test`/`task build`。
