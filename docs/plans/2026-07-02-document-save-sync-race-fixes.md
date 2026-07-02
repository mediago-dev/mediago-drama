# 文档保存与本地目录同步竞态修复规划

日期：2026-07-02
状态：规划（未实施）

## 症状

在文档页输入文字后偶发无法保存；切换文档再回来，刚才输入的内容丢失。

## 现状链路（排查结论）

编辑链路涉及三条并发通路，互相之间没有可靠的排序/对账机制：

1. **键入保存**：TipTap 编辑器每 160ms flush 一次 markdown（`MarkdownHybridEditor.tsx` 的 `markdownChangeFlushDelayMs`）→ `updateDocumentContent`（`stores/document-actions.ts:437`）本地乐观 `version+1`、`isDirty=true`，并**立即** PUT `{content, expectedVersion}`。
2. **定时收尾**：`WritingEditor.tsx:107` 的 500ms 定时器调 `markDocumentSaved`（`document-actions.ts:234`），**先乐观清掉 `isDirty`**，再整份 PUT（title/content/comments 等），**不带 expectedVersion**。
3. **回灌**：服务端每次 API 写盘 → fsnotify 回声 → `SyncLocalMarkdownFiles` → SSE 增量 → 前端 GET 变更文档 → `applyWorkspaceDelta`；另有 SWR 60s 全量兜底轮询。服务端以文件系统为源，每次 update `Version++`（`store.go:678`）。

## 根因（按置信度排序）

### Bug 1：版本号漂移 → 409 → 整库回滚，直接丢字（最可能是用户碰到的）

- `markDocumentSaved` 的 PUT 不带 expectedVersion，服务端 `Version++`，但客户端本地版本**不加**。只有在用户完全空闲、响应通过 `isCurrentDocumentSaveSnapshot` 校验时才会用 savedState 回灌把版本追平。
- 一旦用户在保存往返窗口内继续输入（或切走文档），回灌被跳过 → 本地版本落后服务端。
- 下一次键入 PUT 携带过期 expectedVersion → 服务端 409（`store.go:631`）→ `updateDocumentContent` 的 catch 分支发现本地内容未再变化，就执行 `rollbackWorkspaceStateForProject`，**把整个 store 回滚到本次编辑前的快照** → 编辑器 value effect `setContent` 把刚输入的文字擦掉。
- 触发路径非常日常：「打字 → 停顿 500ms（触发 markDocumentSaved）→ 在其响应返回前继续打字」即可复现概率窗口。
- 另一变体：任一 PUT 因网络失败后，本地版本已乐观 +1 而服务端没加 → 此后**每次保存都 409**，表现为「怎么都保存不上」。

### Bug 2：`isDirty` 提前清除 + 回灌无新旧校验 → 旧回声覆盖新内容

- `markDocumentSaved` 在服务端确认前就把 `isDirty` 置 false（乐观）。
- `applyWorkspaceDelta`（`stores/sync-actions.ts:36`）对非 dirty 文档**无条件采用服务端副本**，不比较 version/updatedAt。
- 时序：早先一次写盘触发的 SSE→GET 响应（内容较旧）在 `isDirty` 被清掉之后才到达 → 旧内容覆盖本地新内容。服务端 `SyncLocalMarkdownFiles` 持有全局锁且含 history/section 重整，GET 延迟数百毫秒并不罕见。

### Bug 3：`hydrateWorkspaceDocuments` 完全没有 dirty 保护

- 各类 mutation 成功后的 `.then` 都调 `hydrateWorkspaceDocumentsForProject` → `hydrateWorkspaceDocuments`（`sync-actions.ts:135`）**整表替换 documents**，不像 `applyWorkspaceDelta` 那样保留 dirty 文档。
- 正在编辑文档 A 时，任何其他 mutation（建/删/移动文档、改分类、section 引用、剪辑台草稿）完成回灌，都会把 A 的未保存内容替换成服务端旧副本。

### Bug 4：切走文档后 dirty 永久残留 → 同步停摆 + 反向覆盖

- `WritingEditor` 的 500ms 定时器随组件重渲染被 cleanup 清掉，切换文档后旧文档的 `markDocumentSaved` 永远不会执行，`isDirty` 永久为 true。
- 后果 a：`DocumentStateSync.hydrateWorkspaceStateFromPayload` 只要**任一**文档 dirty 就跳过全量回灌 → 60s 自愈兜底长期失效。
- 后果 b：该文档从此拒收 SSE 增量（agent/外部编辑进不来）；等用户再次选中它，500ms 后 `markDocumentSaved` 用**过期的本地整份副本**无版本校验地 PUT 回去，可能覆盖服务端期间的新内容。

### 结构性问题

- 双写路径（每 160ms 的 content PUT + 500ms 的整份 PUT）互相竞争，且并发 PUT 无按文档串行队列，乱序到达会制造假冲突。
- 冲突/失败的兜底是「整库回滚」，本质上把**用户刚输入的内容**当成可丢弃状态 —— 方向反了，应当丢弃的是过期的服务端回声。
- 服务端 API 写盘后不更新 `docHashes`，自己的写入必然产生一次 SSE 回声，放大了 2/3 的竞态面。

## 优化方案

原则：**编辑期间本地为权威，服务端确认后才转移权威；所有保存串行化；任何回灌先做新旧校验；冲突绝不回滚本地输入。**

### Phase 1 — 止血（修丢字，改动集中在 store）

1. **单一保存通路 + 按文档串行队列**。新建 `stores/document-save-queue.ts`：
   - 维护每文档 `{ pendingContent, inFlightSave, ackedVersion, ackedContent }`。
   - flush 时若无在途请求才发 PUT（title+content+comments 整份，带 `expectedVersion: ackedVersion`）；响应回来后 `ackedVersion = 服务端返回的 version`，若 pending 又变了则续发下一发。任何时刻每文档最多一个在途 PUT，天然消除乱序与假冲突。
   - `updateDocumentContent` 只更新本地 store + 入队；删除其中的立即 PUT。
   - 删除 `WritingEditor` 里 500ms 定时器和 `markDocumentSaved` 的 PUT 职责；`isDirty` 改为派生语义：`pendingContent !== ackedContent`，由队列在 ACK 时清除，而不是定时器乐观清除。（修 Bug 1、2、4 的定时器根源）
2. **版本对账改为「以服务端响应为准」**：每次 PUT 成功后无条件采纳响应中的 version（只更新版本号，不动比响应更新的本地内容），不再做本地乐观 `version+1`。（修 Bug 1 的漂移与失败后永久 409）
3. **409 处理重写**：GET 最新文档；若服务端内容 == 本次保存的 base（纯版本漂移）→ 采纳新版本号重试；否则本地内容优先重试覆盖（本地单用户工具，且服务端已有文档历史可兜底找回），仅在重试再失败时置 error 状态。**删除 `rollbackWorkspaceStateForProject` 在内容保存失败时的整库回滚**。
4. **回灌统一加保护**：
   - `hydrateWorkspaceDocuments` 增加与 `applyWorkspaceDelta` 相同的 dirty 保留逻辑（修 Bug 3）。
   - `applyWorkspaceDelta` / `hydrateWorkspaceState` / `hydrateWorkspaceDocuments` 对每个文档增加陈旧校验：`incoming.version < ackedVersion` 或本地 dirty → 保留本地。（修 Bug 2）
   - `hydrateWorkspaceStateFromPayload` 的「任一 dirty 就整体跳过」改为按文档粒度合并，恢复 60s 兜底能力（修 Bug 4a）。
5. **切换文档时冲洗**：切换前触发队列 flush（编辑器 unmount 已 flush pending markdown，这里保证队列把它发出去），dirty 不再依赖选中状态。

### Phase 2 — 降噪与加固（服务端配合）

6. **回声抑制**：`saveUnlocked` 成功写盘后同步更新 `docHashes`，API 自身写入不再触发 SSE 增量（外部编辑器/agent 改文件仍正常触发）。
7. **PUT 响应瘦身**：文档保存响应目前带全量 workspace state，客户端只需要该文档的 `{id, version, updatedAt}`；避免用整库快照做回灌来源。
8. **失败重试**：队列对网络类失败做指数退避重试（保留本地内容与 dirty 状态），UI 显示「保存失败，正在重试」，而不是回滚。

### Phase 3 — 可选体验优化

9. 保存状态指示器：`已保存 / 保存中 / 冲突已用本地覆盖 / 保存失败重试中`，替代现在容易说谎的 syncMessage。
10. 编辑器 value effect 在有选区/焦点时避免整文 `setContent`（已有 block diff 路径，可扩大命中率），减少光标跳动。

## 涉及文件

前端（apps/workspace）：
- `src/domains/documents/stores/document-actions.ts` — 移除双写与回滚，接队列
- `src/domains/documents/stores/document-save-queue.ts` — 新增
- `src/domains/documents/stores/sync-actions.ts` — 回灌 dirty/版本保护
- `src/domains/documents/components/WritingEditor.tsx` — 删 500ms 定时器
- `src/domains/documents/components/DocumentStateSync.tsx` — 全量回灌按文档合并
- 对应 store 单测：用交错时序表驱动测试覆盖上述 4 个 bug 场景

服务端（services/server，Phase 2）：
- `internal/service/document/store.go` — saveUnlocked 后更新 docHashes；响应瘦身
- `internal/service/document/local_file_sync.go` — 回声抑制配合

## 验证方式（按约定：只读代码 + 单测，测试由用户自行运行）

- store 单测重演四个竞态：①停顿后续打 409 回滚；②旧回声覆盖非 dirty 文档；③mutation 回灌吞 dirty 文档；④切走后 dirty 残留阻塞全量回灌。
- `pnpm lint / pnpm build`（workspace），`task check / task test`（server，若动 Phase 2）。
