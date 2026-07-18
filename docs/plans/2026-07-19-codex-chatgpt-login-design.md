# Codex ChatGPT 官方订阅登录设计

## 背景

当前 Codex 运行时只提供中转站配置。用户即使拥有可使用 Codex 的 ChatGPT 账号，也无法在 MediaGo 中完成官方登录；如果本机没有另外安装 Codex CLI，更缺少可见的登录入口。

安装包已经内置 `codex-acp` 和对应平台的 Codex 可执行文件，因此登录能力不应依赖用户额外安装 CLI。官方渠道应复用用户全局 Codex 登录态，使 MediaGo、Codex CLI 和 IDE 扩展使用同一账号，避免重复授权。

## 目标

- 在 Codex 设置中增加“ChatGPT 官方订阅”渠道。
- 使用内置 Codex 的 app-server 浏览器 OAuth 流程完成登录。
- 官方渠道读取进程继承的 `CODEX_HOME`，未配置时使用 `~/.codex`。
- 已在 CLI 或 IDE 登录的用户直接复用现有登录态。
- 中转站继续使用 MediaGo 隔离的 Codex home，不覆盖全局凭证。
- 前端和 MediaGo 日志不读取、不返回、不记录 OAuth token。

## 非目标

- 第一版不实现设备码登录。
- 不自行实现 OpenAI OAuth、token 刷新或 token 存储。
- 不把 ChatGPT 订阅转换成 OpenAI API Key。
- 不迁移或复制用户现有的 `auth.json`。
- 不修改 OpenCode 的鉴权逻辑。

## 方案选择

采用 Codex app-server 的结构化账号接口。MediaGo 启动内置 `codex app-server --stdio`，通过 JSON-RPC 调用：

- `account/read`：读取脱敏账号状态。
- `account/login/start`：以 `type: "chatgpt"` 发起浏览器登录。
- `account/login/completed`：接收登录完成通知。
- `account/login/cancel`：取消未完成登录。
- `account/logout`：退出全局账号。

相比解析 `codex login` 的终端文本，app-server 能稳定返回 `authUrl`、`loginId` 和结构化错误，并允许 MediaGo 使用已有 Electron 外链 IPC 打开系统浏览器。

## 目录与渠道边界

官方渠道不设置额外的 `CODEX_HOME` 覆盖。服务进程若继承了 `CODEX_HOME`，Codex 自然使用该目录；否则使用 Codex 默认的 `~/.codex`。这与 CLI、IDE 扩展共享登录缓存和系统凭证库。

中转渠道保持现状，继续使用：

```text
<workspace>/.mediago/codex-relay/codex-home
```

渠道由现有 `codex-relay.enabled` 推导：启用时使用中转配置；关闭时使用官方全局 Codex 配置。切换渠道不会删除另一渠道的凭证。

## 后端架构

新增 `CodexAccountManager`，由 settings service 持有并负责：

1. 接收 agent manifest 解析出的内置 Codex 路径。
2. 启动 app-server stdio 子进程并完成 `initialize` 握手。
3. 将请求 ID 与 JSON-RPC 响应匹配。
4. 管理至多一个待完成的浏览器登录任务。
5. 保存仅包含状态、`loginId`、`authUrl`、错误和时间戳的内存快照。
6. 在成功、失败、取消、超时或服务关闭时结束子进程。

账号状态接口返回邮箱、订阅类型、有效 Codex home 展示路径和是否共享全局目录，不返回 token 或原始凭证文件。

## HTTP API

```text
GET    /api/v1/settings/codex-account
POST   /api/v1/settings/codex-account/login
GET    /api/v1/settings/codex-account/login/:loginId
DELETE /api/v1/settings/codex-account/login/:loginId
DELETE /api/v1/settings/codex-account
```

登录开始接口返回 `authUrl` 与 `loginId`。前端打开 URL 后轮询登录状态；登录完成时重新读取账号状态。重复开始登录返回现有待处理任务，避免多个 localhost 回调服务竞争。

## 前端体验

设置导航将“Codex 中转”改为“Codex 接入”。新页面顶部提供两个渠道：

- ChatGPT 官方订阅
- Codex 中转站

官方渠道显示未登录、等待授权、已登录或错误状态。未登录时提供“使用 ChatGPT 登录”；等待中提供“重新打开浏览器”和“取消”；已登录时显示邮箱、订阅类型及共享目录。

退出按钮使用“退出全局 Codex 账号”，并二次确认会同时影响共享该 Codex home 的 CLI、IDE 和其他客户端。

中转站区域复用现有 `CodexRelayPanel`。选择官方渠道时关闭中转开关；选择中转站后仍由现有校验保证 Profile、API Key 和上游可用。

## 错误与安全

- app-server 不可用：返回“内置 Codex 不可用”，不回退到 PATH 上的未知二进制。
- 外链打开失败：登录任务继续存在，用户可以复制或重新打开 `authUrl`。
- localhost 回调失败：展示 Codex 返回的可操作错误并允许重试。
- 登录 10 分钟未完成：自动取消并清理子进程。
- 切换到中转时：取消待完成登录，但保留已有全局账号。
- 退出时：只调用 Codex 的账号接口，不直接删除 `auth.json` 或操作系统凭证。
- 所有错误在公开前去除可能的 URL query、token 字段和凭证内容。

## 测试与验收

- 使用模拟 app-server 测试 JSON-RPC 初始化、账号读取、登录完成、失败、取消和超时。
- 测试 `CODEX_HOME` 继承与默认目录展示逻辑。
- 测试官方模式不覆盖 ACP 的全局环境，中转模式仍注入隔离目录。
- Handler 测试覆盖重复登录、任务不存在、退出和错误映射。
- React 测试覆盖打开浏览器、轮询完成、取消、渠道切换和退出确认。
- 执行 Go race tests、lint/build，以及 workspace lint、format、test、build。

验收结果：即使用户没有安装 Codex CLI，只要安装包包含内置 Codex，就能在 MediaGo 中通过浏览器登录 ChatGPT；已有全局登录用户无需再次授权；中转站与官方凭证互不污染。
