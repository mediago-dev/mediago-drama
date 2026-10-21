# 开源版隔离与 Codex app-server

状态：已实施。取代 ADR 0002 中的旧协议和后端选择设计。

## 应用身份与存储

Windows AppUserModelID 和 Electron appId 均为 `team.torchstellar.mediagodrama.oss`。
正式环境的用户数据为 `<appData>/mediago-drama-oss/{workspace,electron}`，开发环境为 `~/mediago-drama-oss-dev/{workspace,electron}`。
Electron 在申请单实例锁之前设置独立的 userData 和 sessionData。
打包 sidecar 监听 `127.0.0.1:0`，初始化成功后回报实际端口；主进程把 origin 传给 preload 和 CSP，renderer 不回退到其他版本的固定端口。

## 原生协议

仅安装固定版本 `@openai/codex@0.144.0` 的官方平台原生发行包，直接启动 `codex app-server --listen stdio://`。
不再提供 ACP、OpenCode、自定义协议命令或适配器编译入口。

一个 stdout reader 分发 RPC 响应、通知和服务端请求。审批不阻塞事件读取；所有请求以原始 request ID 回复。
使用 thread/start、thread/resume、turn/start 和 turn/interrupt；只有匹配 turn 的 turn/completed 才能决定成功。
原生文本、推理、计划、命令执行、文件修改和 MCP 事件映射到内部 `agent.runtime` 事件。
审批和结构化提问通过现有会话接口及卡片展示；会话结束或取消时清理待处理请求。

每轮使用新的业务 MCP URL 和 token；进程配置包含 run ID，避免 thread/resume 重连已加载线程时继续使用上一轮工具上下文。
原生 thread ID 保存在 Codex home 和项目索引中，可在进程退出后恢复。

## 账号与中转

ChatGPT 使用 `<workspace>/.mediago-drama/runtime/agents/codex/account-home`；Responses 中转使用相邻的 `relay-home`。
子进程显式指定 CODEX_HOME、文件凭据存储，移除继承的 OPENAI_API_KEY、OPENAI_BASE_URL 和旧 CODEX_CONFIG；中转凭据仅由本项目设置注入。
开发指引通过 thread 参数传递，避免 Windows 环境变量长度限制。
旧版本生成中转配置的 `codex/home` 保留原样，新的 `account-home` 不读取其中的 provider 或凭据，避免停用旧中转后污染 ChatGPT 登录。

## 历史兼容

数据库增加 codex_thread_id 和 codex_instruction_hash，保留旧列和数据。
旧 ACP 标识不复制到新列；历史 JSON 中的旧事件字段在读取时映射到内部 runtime 事件，不改写原始聊天内容。
首次恢复旧对话或更换指引/模型时，用真实历史对话及已确认决定的摘要建立原生线程。网络或认证失败不自动丢弃线程。

## 验证

- 原生 transport：并发响应、服务端请求、长事件和取消读取。
- Runner：新建/续接、MCP 上下文刷新、最终状态、结构化回答和审批取消。
- 使用项目内真实 Codex 二进制与本地 Responses fixture 验证两轮对话及跨进程恢复，无需真实账号或模型服务。
- 桌面侧验证动态端口、readiness、独立数据目录和 CSP。

```powershell
$env:MEDIAGO_TEST_CODEX_BIN = (Resolve-Path packages/vendor/dist/codex/runtime/bin/codex.exe).Path
one exec -p server -- go test -race ./internal/service/codex -run TestBundledCodexAppServerIntegration -v
```

协议参考：https://developers.openai.com/codex/app-server/

Windows 本地验收：前端 211 个文件、1,387 个测试通过；lint、格式、生产构建和 Electron 编译通过。
原生 transport/Runner、会话持久化、数据库兼容迁移、启动、账号/中转与 vendor 测试通过。
使用真实打包 Codex 和本地 Responses/MCP 服务完成两轮对话及原生 thread 恢复；两个 sidecar 同时启动，端口和账号目录独立。

`task check` 中的格式、vet、lint、构建通过；完整 Go 测试仍包含 Windows 下的数据库/JSONL 句柄清理、SSE 时序和旧 CLI shell fixture 失败。
已在改造前提交的源码副本中复现数据库清理和 CLI fixture 失败，未将完整 Go 门禁标记为通过。
