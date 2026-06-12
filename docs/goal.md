# mediago-drama 分阶段代码优化计划

## Context

用户要求全仓分析（前后端架构、性能、虚拟滚动、Zustand 审查、废弃代码），只规划不改码，后续按「先后端再前端」分阶段实施。

**本计划基于 main @ 750332f4（工作区干净）。** 今天早些时候的会话已在同一 commit 上完成过完整分析（产出见 `~/.claude/plans/splendid-orbiting-ladybug.md`，含实际生产构建的 bundle 基线）；本会话对其中全部关键论断做了抽样核实（store.go:454 O(N²) 读取、store.go:211 逐条事件写、db.go 无 WAL、prompt_builder.go:44 与 app.go:68/80 每请求重建 StateService、src/router/routes.tsx 零懒加载、4 个零引用死文件），全部成立，故直接采纳并修订该计划。Zustand 部分已按要求联网核对 v5 最佳实践（pmndrs 官方 discussion #2867 等）。

**技术栈确认**：
- 前端 [apps/workspace](apps/workspace)：React 19 + Vite 8 (rolldown) + Zustand 5 + SWR 2 + Tailwind 4 + tiptap 3 + Tauri 2 桌面壳（~55,300 行 TS，517 文件）
- 后端 [packages/server](packages/server)：Go 1.25 + Gin + GORM + SQLite（glebarez 纯 Go 驱动）+ JSONL 文件事件存储（~53,600 行）
- 另有 packages/core（生成核心 Go 库）、packages/mcp、apps/app（Ionic 移动端壳，疑似残留）、packages/tools（空占位）
- 后端分层 handlers → service → repository → domain，整体清晰；持久化 = SQLite（任务/会话索引/资产元数据）+ 文件系统（agent 事件 JSONL、markdown 文档）

## 问题总清单（按严重程度排序）

| # | 级别 | 问题 | 位置 |
|---|---|---|---|
| B1 | P0 后端 | agent 事件 JSONL 读取 O(N²)，聊天接口每次全量回放 | service/chat/store.go:387,454 |
| B2 | P0 后端 | 每条流式事件：开关文件 + 全局写锁 + SQLite upsert | service/chat/store.go:211 |
| B3 | P0 后端 | 每次构建提示词 / 每个 MCP 请求重跑 AutoMigrate | app/prompt_builder.go:44、app/app.go:68,80 |
| F1 | P0 前端 | 流式 token 触发整条时间线全量重渲染 + markdown 全量重解析 | agent stores + AgentTimeline |
| F2 | P0 前端 | 无路由级代码分割，首屏 JS ~2.6 MB（gzip 766 KB） | src/router/routes.tsx、vite.config.ts |
| B4 | P1 后端 | SQLite 未启用 WAL / synchronous 调优 | repository/db.go |
| B5 | P1 后端 | 生成任务后台轮询串行（可并行） | generation_runtime_tasks.go:281 |
| F3 | P1 前端 | 聊天页与创作台长列表无虚拟滚动、无 memo | AgentChat / AgentTimeline / GenerationChatPanel |
| F4 | P1 前端 | agent store 派生状态 messages 存成镜像，~20 处手动同步 | domains/agent/stores |
| B6 | P2 后端 | 文档保存/排序走全量 workspace state 替换 | workspace.go + document-actions.ts |
| B7 | P2 后端 | ListGenerationTasks 无分页；lower(status) 绕过索引 | generation_task_repo.go:32 |
| F5 | P2 前端 | AgentChat 订阅全部文档正文，编辑器击键即重渲染聊天面板 | AgentChat.tsx:72 |
| F6 | P2 前端 | 创作台 2.5s 轮询与 SSE 通知通道重复 | useGenerationTaskActions.ts:164 |
| D1 | P2 清理 | 143 个重导出垫片 + 7 个零引用文件 + 模板残留 | 见阶段 3 清单 |
| R1 | P2 后端 | 媒体文件服务直接 ServeFile DB 中路径，无目录包含校验 | http/handlers/media.go:73 |
| R2 | P2 后端 | 后台 worker 无优雅关停（与 1.5 缓冲写联动后必须做） | app/generation_worker.go:23 |
| R3 | P2 前端 | 通知 SSE 用原生 EventSource，半死连接不恢复 | GenerationNotificationSync.tsx:28 |
| R4 | P2 前端 | 项目/会话快速切换的异步竞态防护不完整 | AgentStateSync.tsx、AgentPanel.tsx |
| R5 | P3 双端 | 零散健壮性项（无 ctx 的 HTTP 请求、吞错、重复 util） | 见阶段 4 |

---

## 阶段 1：后端优化（第一优先级）

### 1.1 SQLite 启用 WAL（B4，先做）
- **证据**：`internal/repository/db.go` OpenGormSQLite 只设 busy_timeout/foreign_keys，无 journal_mode 设置（已 grep 确认）；本服务读写并发高（SSE 回放读 + 事件索引写 + 生成 worker 写并发）
- **改动**：open 后追加 `PRAGMA journal_mode=WAL` + `PRAGMA synchronous=NORMAL`
- **收益**：写不再阻塞读，busy 等待显著减少。**风险**：低（本地单机库标准配置；Tauri 打包目录可写 -wal/-shm）
- **验证**：`cd packages/server && go test ./...`

### 1.2 AutoMigrate Once 化（B3）
- **证据**：`app/prompt_builder.go:44` 每次构建 agent 提示词 `appworkspace.NewStateService(request.WorkspaceDir)`；`app/app.go:68,80` 每个 MCP HTTP 请求 NewExternalServer/NewDocumentServer → 新 StateService。链路 NewStateService → OpenWorkspaceDB → EnsureWorkspaceSchema 对 7 个模型跑 AutoMigrate + dropDeprecatedWorkspaceStorage 的 HasTable/PRAGMA 检查。连接有 sqliteDBCache 缓存，**但 migration 每次重跑**（每模型十几条 PRAGMA/DDL）
- **改动**：repository/db.go 按 dbPath 加「已迁移」标记（与 sqliteDBCache 同位置）；EnsureSettingsRepositorySchemas 同样处理；或把 api.workspaceState 实例传入 MCP 工厂与 prompt builder
- **收益**：每条 agent 消息、每次工具调用减掉几十条 DDL，agent 循环延迟直接下降。**风险**：低（同进程 schema 不变）
- **验证**：api_test.go 全绿；对比单条消息 SQL 查询数

### 1.3 事件文件读取消 O(N²)（B1 上半）
- **证据**：`service/chat/store.go:454` loadAllAgentEventsUnlocked 按 1000 条/批循环，每批都从文件头重新打开扫描（store.go:337）、逐行 Unmarshal 后丢弃 sequence ≤ after 的行 → N 条事件扫 N/1000 次全文件，O(N²/1000)。本地压测样例曾出现单会话 2 条用户消息产生 5,872 条事件
- **改动**：Service 增加 path → 文件字节偏移缓存（参照现有 lastEventSequences 模式），loadAgentEvents(after) 用 Seek 续读
- **收益**：长会话（万条事件）加载从秒级降到毫秒级，SSE 重连回放同步受益。**风险**：中，需处理文件被 clear/删除时的偏移失效
- **验证**：agent_event_log_test.go、agent_event_sequence_test.go；构造 1 万条事件实测耗时

### 1.4 聊天状态投影增量缓存（B1 下半）
- **证据**：GET /agent/chat（store.go:372-411，store.go:387 调 loadAllAgentEventsUnlocked(…, 0)）每次请求全量加载所有事件重新投影，无缓存
- **改动**：按 session 缓存上次投影结果 + lastSequence，增量应用新事件（projectAgentChatState 已接受 base 参数，结构现成）；clearAgentChat/会话删除时失效
- **收益**：聊天页打开/刷新从全量回放变 O(增量)。**风险**：中，缓存失效路径要全覆盖
- **验证**：agent_streaming_test.go + 接口响应一致性对比

### 1.5 事件追加合批 + 锁降粒度（B2）
- **证据**：appendAgentEvent（store.go:211）对每条事件：全局 store.mu 写锁（阻塞所有读）→ os.OpenFile → 写一行 → Close；另外每条还 upsertAgentSessionIndexUnlocked（先 Get 再 Upsert，2 次 SQLite 往返）。流式期间每秒走几十次
- **改动**：per-session 持久文件句柄（空闲超时关闭）+ bufio（终态事件 agent.run.completed/failed 立即 Flush，delta 合批）；会话索引 upsert 节流（状态变化立即、delta 按周期）；锁从全局降为 per-session
- **收益**：流式期间磁盘 syscall 减少 90%+，消除流式写与聊天读互相阻塞。**风险**：中，需保证进程退出/崩溃时缓冲落盘（终态同步刷控住最坏情况）
- **验证**：fs_usage 统计 syscall；崩溃恢复手测

### 1.6 生成任务轮询并行化（B5）
- **证据**：generation_runtime_tasks.go:281 PollPendingGenerationTasks 串行 for 循环，每任务含 30s 超时的供应商 HTTP 调用——5 个慢任务一轮最坏 150s+
- **改动**：errgroup.WithContext + SetLimit(3~5)；任务间无共享状态（各自 Upsert 自己的行）
- **收益**：多任务并发时状态延迟从分钟级到秒级。**风险**：低，SQLite 写并发由 1.1 WAL 兜底
- **验证**：多 pending 任务延迟对比

### 1.7 接口收尾（B6/B7）
- generation_task_repo.go:32 ListGenerationTasks 加默认 LIMIT/分页；status 入库统一小写消掉 lower()
- 文档排序/移动改走已有单文档 PATCH 路由（前端配合见 2.5）；全量 PUT /workspace/state 仅保留导入/恢复场景
- 一次性迁移（migrateMiniMax…、backfillOfficial…、dropDeprecated…）加版本标记不再每次启动跑
- **架构项（已确认纳入）**：app.go 268 行内联注册全部路由且 internal/http/routes/ 为空目录；NewAgentMessages(api) 等 handler 直接依赖 apiHandler 具体结构体。路由按域拆进 http/routes/（agent、generation、workspace、settings…），handler 依赖收敛为窄接口。作为阶段 1 最后一个独立 PR，纯搬移不改行为
- **验证**：接口契约测试；路由表前后 diff（gin Routes() 输出对比）确保零行为变化

---

## 阶段 2：前端优化

### 2.1 流式 delta 合批（F1-①）
- **证据**：controller.ts:528 每个 SSE delta 同步调 appendAssistantDelta → lifecycle-actions.ts:79 map 整个 messages 数组生成新引用
- **改动**：SSE 入口缓冲 30–50ms（或 rAF）合并 delta 后一次性写 store
- **收益**：store 写入频率降一个数量级。**验证**：React Profiler 流式 commit 次数

### 2.2 时间线 memo 化 + 流式尾巴隔离（F1-②③）
- **证据**：AgentTimeline.tsx:45 起所有条目组件无 React.memo；buildTimelineEntries 每次全量重算；MarkdownContent.tsx:8 手写 markdown 解析器每次渲染全量重解析；AgentChat.tsx:144 每次 messages 变化 scrollTo smooth
- **改动**：TimelineUserTurn/TimelineAssistantGroup/ToolCallCard/MarkdownContent 加 React.memo；MarkdownContent 解析结果 useMemo(content)；「正在流式的最后一条」拆独立组件单独订阅 streamingMessageId，历史条目对 delta 免疫
- **收益**：长会话流式 CPU 预计降 80%+（O(全部消息×token) → O(token)）。**风险**：低-中，纯渲染层
- **验证**：500+ 消息会话流式 CPU 对比；store.test.ts

### 2.3 路由懒加载 + chunk 拆分（F2）
- **证据**（实际构建产物基线）：vendor 1802 kB (gzip 532 kB) + index 607 kB (gzip 167 kB) + ui 157 kB 全部首屏加载；`src/router/routes.tsx` 全静态 import、0 处 lazy（已确认）；tiptap/xterm/vidstack/a2ui/photo-view 全进 vendor
- **改动**：routes.tsx 全部页面 React.lazy + Suspense（Settings、Studio 六子页、ProjectOverview、EpisodeTimeline、Debug）；vite.config.ts manualChunks 拆 tiptap / media(vidstack+photo-view) / xterm / a2ui；MarkdownHybridEditor/WritingEditor 组件级动态 import
- **收益**：首屏 JS 预计降到 gzip ~250 KB（-65%），Tauri 启动解析时间同步下降。**风险**：低，lazy 边界放路由层避免常驻组件闪烁
- **验证**：pnpm build 产物对比基线

### 2.4 删除 agent store 的 messages 镜像（F4 / Zustand 问题①「派生状态入库」）
- **证据**：messages、streamingMessageId、isRunning 均为 conversations[rootRunId] 的手工镜像；lifecycle-actions.ts / activity-actions.ts 约 20 处 `messages: rootConversation(...)?.messages ?? state.messages` 同步行，漏一处即状态不一致
- **改动**：删 messages 字段，selectors.ts 派生：
  ```ts
  const EMPTY: AgentMessage[] = [];
  export const selectAgentMessages = (state: AgentState) =>
    state.rootRunId ? (state.conversations[state.rootRunId]?.messages ?? EMPTY) : EMPTY;
  ```
  conversations[rootRunId] 引用只在该会话变化时变，selector 输出天然稳定，无需 useShallow；删除全部同步行（净减 100+ 行）。isRunning 可保留作缓存（O(conversations) 计算的可接受折中）
- **验证**：store.test.ts、conversation.test.ts 全绿

### 2.5 store 副作用与订阅收敛（Zustand 问题②③④ / F5）
- **问题② updater 不纯**：document-actions.ts:264 等在 set() updater 内部发起网络请求 + rollback。改为「set 乐观更新 → set 外发请求 → 失败再 set 回滚」，参照 sync-actions.ts 既有正确写法；排序走 PATCH 对接 1.7
- **问题③ 旁路通知**：generationHistory.ts:189 persist 之外又用 window CustomEvent 跨组件通知——zustand 本身响应式，删 CustomEvent 通道改直接订阅
- **问题④ 整库订阅**：ThemeProvider.tsx:7、sonner.tsx 整 store 解构改 `(s) => s.mode` 细粒度 selector；F5：AgentChat.tsx:72 `useDocumentsStore((s) => s.documents)` 订阅全部文档正文只为算活动文档批注 → 编辑器每次击键重渲染聊天面板，加「活动文档未解决批注」selector 或拆独立小组件
- **Zustand 总评**（对照联网核对的 v5 最佳实践：atomic selector、selector 保持简单稳定/复杂计算放 hook、多值用 useShallow、派生状态进 selector 不入 store、大 store 用 slice 拆分、persist 用 partialize+version、updater 纯函数）：本库纪律性高于平均——组件几乎全走 selector（仅上述 2 例外）、persist 全带 partialize+version+merge、devtools 仅 dev 启用、agent/documents store 已按 action 文件拆分（事实上的 slice 模式，无需再拆 store）。问题集中在上述 4 项
- **验证**：vitest + 手测编辑器击键不再重渲染聊天面板

### 2.6 虚拟滚动接入（F3）
- **现状**：AgentTimeline.tsx:55 与 GenerationChatPanel.tsx:67 均为纯 .map() 全量渲染 + 手写 scrollRef/shouldStickToBottomRef/isNearScrollBottom 贴底；package.json 无任何虚拟滚动库（已确认）
- **选型（已确认：react-virtuoso）**：
  | 方案 | 动态高度 | 贴底/跟随输出 | 体积 | 评价 |
  |---|---|---|---|---|
  | react-virtuoso | 自动测量零配置 | 内置 followOutput/atBottomStateChange，聊天场景成熟（Rocket.Chat 生产使用） | ~16 kB gzip | **已选定** |
  | @tanstack/react-virtual | measureElement | 贴底/流式增长需自写胶水 | ~5 kB | headless 灵活但代码量最大 |
  | virtua | 支持 | reverse/shift 支持，较新 | ~3 kB | 最轻但聊天成熟度不及 virtuoso |
- **改动**：AgentChat.tsx 滚动容器换 `<Virtuoso data={entries}>`、AgentTimeline.tsx 拆 itemContent、GenerationChatPanel.tsx 同样替换；删全部手写贴底逻辑
- **场景处理**：
  - 动态高度：virtuoso ResizeObserver 自动测量；图片/视频卡片给占位尺寸 + defaultItemHeight 减少跳动
  - 贴底：`followOutput={(atBottom) => atBottom ? "smooth" : false}`（上翻阅读不被拽回，复刻现行为）
  - 流式更新：最后一条增长自动重测并保持贴底（配合 2.1 合批无性能问题）
  - 初始定位：`initialTopMostItemIndex={entries.length - 1}`；PhotoProvider 包列表外层不受影响；条目 key 已是稳定 id
- **顺序建议**：先 2.1/2.2（memo+合批）观察长会话是否仍卡，虚拟化作为第二步——同时解决万条消息 DOM 内存问题，两者互补
- **验证**：万条消息滚动 FPS；贴底/上翻/流式增长手测

### 2.7 SSE 主驱动生成刷新（F6）
- **证据**：useGenerationTaskActions.ts:164 有 pending 任务时每 2.5s 全量拉任务列表 + 每 5s refreshVideo，而后端已有 generation/notifications/events SSE
- **改动**：以 SSE 通知驱动 mutateTasks，轮询降为 30s 兜底
- **收益**：挂着创作台时请求数 -90%。**验证**：Network 面板对比

---

## 阶段 3：废弃代码清理（可随时插队，风险最低，不直接删）

### 3.1 清单一：确认可删除（已验证全仓 0 处 import，本会话抽查复核）
| 文件 | 依据 |
|---|---|
| src/api/auth.ts、src/api/demo.ts、src/api/users.ts | react-spa 模板残留，0 引用（已 grep 复核） |
| src/pages/Generate.tsx | 不在 src/router/routes.tsx，已被 Studio 子页取代 |
| domains/agent/components/chat/AgentConversationTree.tsx、DocumentToolApprovalCard.tsx | 0 引用 |
| domains/capabilities/components/CapabilityCard.tsx | 0 引用（该目录唯一组件） |
| 零引用 barrel：domains/{agent,documents,episode,generation,projects,workspace}/index.ts、lib/index.ts、lib/stores/index.ts 及 4 个子目录 index、shared/index.ts、shared/lib/index.ts、shared/lib/sse/index.ts、shared/stores/index.ts | 自动扫描 + 抽样 grep 复核 0 import |
| 零引用垫片目录：components/agent(12 文件)、components/workspace(9)、components/ui(10)、components/documents、components/episode、components/generation、components/workbench(空) | 全是 `export * from "@/domains/..."` 单行重导出，对应路径 0 import |
| packages/server/internal/http/routes/ | 空目录（若不做 1.7 架构项则删） |
- 验证：tsc -b + vitest + oxlint

### 3.2 垫片收尾（先替换引用再删）
- @/lib/stores/*（仍有 22 处 import）、@/hooks/*（22 处）、@/api/{agent,generation,projects,workspace}.ts 垫片：全局替换到 @/domains/... 真实路径后删除（机械替换）
- 验证：tsc -b + pnpm check

### 3.3 旧结构迁入 domains 统一（已确认纳入）
- src/api/{media,prompt-presets,settings,skills,prompt-templates}.ts 真实现模块（25/12/4 处引用）迁入对应 domains/*/api/；components/debug（3 引用）、components/settings（7 引用）迁入 domains
- 机械搬移 + 全局替换 import（约 50 处），tsc -b 兜底
- 验证：tsc -b + vitest + pnpm check

### 3.4 已确认保留项（移出清理范围，仅记录）
| 项 | 处置 |
|---|---|
| apps/app Ionic/Capacitor 移动端（2150 行） | 用户确认保留，不动 |
| packages/tools 空占位 Go 模块 | 用户确认保留，不动 |
| .github/workflows/*.yml.disabled（6 个） | 用户确认保留，不动 |
| Go 一次性历史迁移（migrateMiniMax…等） | 不删，在 1.7 中加版本标记不再每次启动跑 |

（knip 防回潮：用户确认不引入，依赖人工清单）

---

## 阶段 4：健壮性与代码质量补充（超出原五个方向的新发现，P2-P3）

> 本阶段来自第二轮针对性扫描（健壮性/安全/并发/错误处理），关键项已逐条人工核实。两条 agent 误报已剔除：顶层 ErrorBoundary 实际存在（main.tsx:17）；会话标题生成 goroutine 内部已有 WithTimeout。

### 4.1 后端

- **R1 媒体路径包含校验**（media.go:73 已核实）：HandleGetMediaAssetContent 直接 `http.ServeFile(..., asset.FilePath)`，FilePath 来自 DB 无包含性校验；service/media/store.go:439 studioDir 同类。本地单机应用实际风险低，但属防御加固：校验 `filepath.Abs` 后必须落在 workspace/media 根目录内。验证：路径穿越用例测试
- **R2 后台 worker 优雅关停**（generation_worker.go:23-32 已核实）：`for { <-timer.C; poll(context.Background()) }` 无限循环无退出通道。单独看影响小（进程退出即终止），但**1.5 引入缓冲写后必须有 flush-on-exit**，两者应同一 PR 设计：app 级 ctx + shutdown hook（Tauri 退出时 flush 事件缓冲、停 worker）。验证：退出时无丢事件手测
- **R3 内部事件发布器**（http_publisher.go:73,79 已核实）：`http.NewRequest` 不带 context、重试用 `time.Sleep` 阻塞调用方。改 NewRequestWithContext + select{time.After, ctx.Done}。低风险小改
- **R4 重复 util**：mustRandomID 在 app/api.go:131、app/mcp/helpers.go:13、service/agent/agent_event_projection_tool.go:175 三处重复定义（grep 已核实）——抽到公共包，顺带确认熵源为 crypto/rand
- **R5 测试盲区**：service/workspaceevent/broker.go（事件 pub/sub 核心）无测试文件；事件满时 default 分支静默丢弃（broker.go:62-66，有日志可接受）——补订阅/退订/慢消费者用例
- **待复核项**（agent 报告、未逐条人工核实，实施时先确认）：acp_client_permission.go:69 权限决策 channel 与超时竞态；workspace_file_watcher.go:117 timer.Stop 与回调竞态

### 4.2 前端

- **R3 通知 SSE 治理**（GenerationNotificationSync.tsx:28 已核实）：直接 `new EventSource(...)` 且无 onerror，绕过了仓库自有的 ManagedEventSource（带 45s 心跳超时/重连）。统一改用 ManagedEventSource。与 2.7 同 PR 顺手做
- **R4 切换竞态加固**：AgentStateSync.tsx:73 有 cancelled flag 但 catch 链有缺口；AgentPanel.tsx:172 getAgentChatState 返回时 projectId 可能已切换。统一「请求发起时快照 id，落地前比对」或 AbortController 模式，抽公共 hook。验证：快速连续切换项目手测 + 单测
- **R6 零散项**：6 处 `.catch(() => {})` 静默吞错（grep 已核实，部分有注释说明意图）——统一加 debug 日志；controller.ts:790 waitForStreamingRun 的 1s 轮询降级路径并入 2.7 一起审视；CodeBlocks.tsx:213 卸载后 setTimeout 残留（影响极小，顺手修）

### 实施建议
- R2 并入 1.5 的 PR（强关联）；前端 R3/R6 轮询项并入 2.7 的 PR；其余各自独立小 PR，随时可插队
- 本阶段不引入新依赖、不做错误上报系统（本地应用，暂无必要）

---

## 实施约定（用户已确认）

- **本次仅交付计划，不实施**；后续在新会话中按阶段发起
- 提交方式：沿用现状，本地 main 上逐任务独立 commit，不 push
- 验收标准：P0 关键项做量化前后对比（万条事件加载耗时、Profiler 流式 commit 数、构建产物大小），其余项测试绿即可
- 不引入 knip；疑似废弃项（apps/app、packages/tools、.disabled CI）全部保留

## 建议实施顺序与风险总评

1. **先行项（低风险高收益）**：1.1 WAL → 1.2 AutoMigrate → 1.6 轮询并行；前端 2.1 合批 → 2.3 懒加载
2. **核心项（中风险，独立 PR）**：1.3/1.4/1.5 事件存储三连（依赖 chat store 既有测试集）；2.2 memo → 2.4 删镜像 → 2.6 虚拟滚动
3. **收尾项**：1.7、2.5、2.7、阶段 3 清理（可随时插队）
4. **健壮性补充（阶段 4）**：R2 并入 1.5 同 PR；前端 SSE/轮询项并入 2.7 同 PR；其余独立小 PR 随时插队

每个任务独立 PR、独立可验证：
- 后端每步：`cd packages/server && go test ./...`（或根目录 task check）
- 前端每步：`pnpm -C apps/workspace test && pnpm -C apps/workspace check && pnpm -C apps/workspace build`
- 已留存基线：vendor 1802 kB/gzip 532 kB、index 607 kB/gzip 167 kB、ui 157 kB；流式重渲染 commit 数与事件加载耗时在对应任务中做前后对比

Zustand 最佳实践参考来源：[pmndrs/zustand discussion #2867（v5 selector 最佳实践）](https://github.com/pmndrs/zustand/discussions/2867)、[zustand 官方文档](https://zustand.docs.pmnd.rs/learn/index)、[Zustand v5 指南](https://jsdev.space/howto/zustand5-react/)
