# 技能包本地草稿持久化设计

## 目标

技能包内容编辑继续采用“显式保存”模型，但未正式保存的编辑会通过 Zustand `persist` 中间件写入 `localStorage`。关闭窗口、刷新页面、切换技能包或返回列表都不会丢失草稿，也不会因此自动修改服务端正式数据。

## 状态与存储

新增领域级 Store：

`apps/workspace/src/domains/settings/stores/prompt-pack-drafts.ts`

Store 使用 `create`、`persist`、`createJSONStorage` 和 `immer`，沿用项目已有 Zustand 约定。存储键为 `prompt-pack-drafts.v1`，持久化版本为 `1`。

```ts
interface PersistedPromptPackDraft {
  packId: string;
  baseRevision: string;
  updatedAt: string;
  working: PromptPackDraftContents;
}

interface PromptPackDraftState {
  draftsByPackId: Record<string, PersistedPromptPackDraft>;
  putDraft: (draft: PersistedPromptPackDraft) => void;
  removeDraft: (packId: string) => void;
}
```

只持久化 `draftsByPackId`。动作函数、临时弹窗状态、当前选择项、校验错误、保存 loading 状态不进入 `localStorage`。草稿保存完整工作副本，但不重复保存 base 内容；恢复时以服务端当前内容作为 base，通过 `baseRevision` 判断是否仍可安全继续编辑。

## 页面交互

首次点击“编辑”时，以当前服务端内容创建工作副本并写入 Store。编辑字段、新增、删除、修改分组和拖拽后，工作副本立即更新，Zustand `persist` 同步更新 `localStorage`。

重新打开技能包时保持只读：

- 没有本地草稿：显示普通“编辑”。
- 存在草稿且 revision 一致：显示“发现未保存草稿”提示，以及“继续编辑”“放弃草稿”。
- 点击“继续编辑”：载入持久化 working snapshot 并进入编辑态。
- 点击“放弃草稿”：二次确认，删除 Store 中该包草稿，继续展示服务端内容。

编辑态顶部用明确的“放弃草稿”替代含义模糊的“取消”。正式保存成功后清除本地草稿并退出编辑态。保存失败时保留草稿和编辑态。

## 关闭与导航

窗口关闭、刷新、返回列表或切换技能包都不自动正式保存，也不删除草稿。因为 Store 已同步写入 `localStorage`，这些操作可直接继续；重新进入相同技能包时由恢复提示承接。

窗口关闭前仅需确保当前同步状态已进入 Store。由于 `localStorage` 是同步存储，不使用会在关闭时丢尾部内容的防抖写入。若未来草稿规模导致输入卡顿，再迁移到异步 IndexedDB，而不是给同步存储叠加未 flush 的 debounce。

## Revision 冲突

恢复草稿前比较服务端 `contents.revision` 与草稿 `baseRevision`：

- 一致：允许继续编辑和保存。
- 不一致：显示“服务端内容已变化，此草稿基于旧版本”。不自动覆盖，也不自动合并。
- 冲突态只提供“放弃旧草稿”；第一版不实现三方合并，避免误覆盖。

正式保存仍携带 `baseRevision`，后端再次检查并以 409 拒绝竞态窗口中的过期提交。

## 失败与容量

Store 的 `merge`/`migrate` 必须验证持久化对象，丢弃损坏、版本不支持、缺 pack ID/revision 或结构非法的数据。`localStorage` 写入异常不得影响内存中的当前编辑，但 UI 必须提示“草稿仅保留在当前窗口，关闭后可能丢失”。

默认包和导入包不会创建内容草稿；后端仍强制拒绝其内容写入。删除整个本地技能包时，同时清除对应草稿。

## 验收标准

- 每次编辑动作后，刷新页面仍能发现该草稿。
- 重新打开不会自动进入编辑态。
- “继续编辑”恢复完整内容、分组、归属和顺序。
- “放弃草稿”清除本地记录并恢复服务端版本。
- 正式保存成功后不再提示存在草稿。
- 关闭、返回、切包不会自动调用正式保存接口。
- revision 冲突不会覆盖服务端数据。
