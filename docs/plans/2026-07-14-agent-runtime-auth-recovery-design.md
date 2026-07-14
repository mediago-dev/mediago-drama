# Agent Runtime 认证恢复设计

## 目标

修复干净 Windows 环境中 Codex ACP 尚未认证时，运行配置探测失败却被表现为“模型下拉框凭空消失”的问题。修复后，探测失败必须成为明确、可恢复的界面状态；用户可以前往正确的设置页补齐凭据，返回后重新探测并恢复模型选择。

## 方案选择

采用“真实错误状态 + 显式恢复操作”。ACP `RequestError` 的 `-32000` 会被精确识别为认证缺失，运行配置接口返回非成功响应和安全中文提示；其他启动、超时或资源错误返回通用的运行时不可用提示。前端只在没有旧配置可继续使用时展示紧凑警告，并提供“重试”和“前往设置”。Codex 跳转到全局“Codex 中转”，OpenCode 跳转到“API 密钥”。设置成功后主动使所有 `runtime-config` 缓存失效。

不采用以下方案：手动创建空 `runtime`，因为它不包含认证信息；返回伪造模型，因为真正发送消息仍会失败；在 `GET runtime-config` 中自动调用 ChatGPT 登录，因为 SWR 探测不应产生打开浏览器的副作用，而且当前十秒请求超时无法承载交互登录。完整的 ChatGPT 浏览器登录应作为独立的显式 POST 流程设计。

## 数据流与错误处理

`InspectSessionConfig` 保留底层 ACP typed error。HTTP handler 使用 ACP 协议错误码识别认证缺失：认证错误与其他探测错误都表示依赖运行时当前不可用，返回 `503`，但使用不同、安全的公开文案；内部原因仅写日志。前端 HTTP 层产生的是普通 `ApiError` 对象，因此错误解析同时支持 `{ code, message }`，不能只依赖 `instanceof Error`。

Agent 页面关闭 SWR 的自动错误重试，避免持续拉起失败的 ACP 进程。显式重试期间恢复 loading 状态。已有模型选项时，即使后台刷新失败也继续展示旧选项，避免一次短暂错误破坏可用会话。Relay 设置只要已经持久化，就会在流程结束时清空 runtime-config 缓存；即使后续连通性检查或回滚失败，也不会让旧模型列表掩盖已经变化的凭据。

## 测试

Go 测试覆盖 ACP typed auth error、普通错误、handler 成功/认证失败/通用失败，以及响应不泄漏内部错误。React 测试覆盖错误文案、重试/设置回调、普通 `ApiError` 解析、旧配置保留、正确设置路由，以及 Codex Relay 成功或校验失败后的 runtime cache 失效；另覆盖 Agent 页面已卸载时的 dormant cache。最后运行前端 lint、format、build 与服务端 check、test、build。
