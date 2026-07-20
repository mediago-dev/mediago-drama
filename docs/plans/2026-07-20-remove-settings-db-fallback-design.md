# 移除 settings.db 旧路径 fallback 设计

## 目标

服务端只使用当前 workspace 下的 `.mediago-drama/db/settings.db`。删除 `DefaultSettingsDBPath()` 以及所有会隐式打开用户配置目录 `settings.db` 的构造逻辑，避免仅初始化 Prompt、Skill 或生成偏好服务时，在 `~/Library/Application Support/mediago-drama/settings.db` 创建第二份空数据库。

## 依赖注入

主服务继续由 `internal/app/wire.go` 打开 workspace settings repositories，并把具体 repository 注入 Prompt Template、Prompt Pack、Prompt Library、Generation Preference 和 Skill Registry。服务层不再自行解析数据库路径。

删除 Prompt Template、Prompt Library 和 Prompt Pack 中依赖旧默认路径的无参兼容构造函数。Generation Preference 保留接收路径的构造函数供独立测试和明确调用使用，但空路径不再回退，而是保存初始化错误。运行时 Prompt 和 Skill 的全局入口若尚未完成注入，将返回“store 未配置”错误；已有的上层错误处理或内置 Prompt 描述 fallback 继续工作，但不会访问磁盘。

## 错误处理与验证

缺少 repository 是启动或调用方 wiring 错误，应快速暴露，而不是通过另一份数据库掩盖。主服务正常 wiring 的行为和 workspace 数据迁移逻辑不变。

测试覆盖空数据库路径会报错且不会在用户配置目录创建 `settings.db`。现有 workspace 默认路径测试改为直接断言旧路径不存在，不再依赖被删除的生产函数。最后运行相关 Go 单元测试、格式检查、静态检查和构建。
