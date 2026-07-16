# Agent 视频生成设置与批量弹窗同源设计

## 目标

Agent 发起视频生成时，不再展示由 `generation_params`、`images`、`prompt_optimization` 分散拼装的旧参数卡，而是与“批量生成视频设置”复用同一个 `GenerationSettingsForm`、同一套默认值恢复、提示词包、参考图、模型路由参数和校验逻辑。

## 方案

新的视频 `generation_plan` 只包含一个 required `generation_settings` 字段，并明确携带 `kind: "video"`。字段提交完整快照：`kind、routeId、label、params、referenceAssetIds、promptSupplements、promptOptimization`。Agent 卡片仍保留自己的标题、说明与确认按钮外壳，共享的只是设置表单主体和 controller，因此批量弹窗的“已选 N 项”等批量语义不会进入 Agent 对话。

前端适配器根据字段 `kind` 初始化共享 controller；图片和视频分别恢复各自的批量生成偏好。服务端允许 `generation_settings` 的 kind 为 image 或 video，并要求字段 kind 与提交值 kind 严格一致，再用完整快照授权同一 run 中的生成请求。

## 兼容性

历史会话中已经持久化的旧视频表单仍可使用 `generation_params` 加可选参考图、提示词优化字段读取和提交。MCP 与视频生成 Skill 只会创建新的统一表单，避免继续产生分叉数据。

## 验证

- 前端测试确认 Agent 视频字段传入共享表单的 `kind` 为 video，并提交规范化完整值。
- selection 测试覆盖视频完整设置的创建、嵌套值校验和 kind 不匹配拒绝。
- generation authorization 测试覆盖视频路由、参数、参考图、补充提示词与提示词优化的快照一致性。
- MCP 与内置 Skill 测试锁定新协议，同时保留旧视频协议兼容测试。
