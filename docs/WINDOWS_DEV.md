# Windows 开发启动

这个源码包不包含项目数据、图片生成记录、API Key、Mac 二进制或 `node_modules`。

## 环境

- Node.js 22 LTS
- pnpm 10（执行 `corepack enable` 后可使用）
- Go 1.24 或更高版本
- Task（`go install github.com/go-task/task/v3/cmd/task@latest`）

## 启动开发桌面 App

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm dev:desktop
```

首次启动会下载 Windows 所需的本地媒体工具，并在当前 Windows 用户的应用数据目录创建新的空工作区。

## 构建 Windows x64 包

```powershell
task build:electron:target PLATFORM=windows-x64
```

构建产物位于 `apps/workspace/release/`。发布包不会包含任何本机项目或 API 配置；接口请在 Windows App 的“设置 → 图片生成 API”中重新配置。
