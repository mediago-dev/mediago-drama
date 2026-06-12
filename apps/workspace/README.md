# Web CSR React Template

面向浏览器端单页应用的 React 模板，当前基线已经切到 `shadcn/ui + Tailwind CSS v4 + CSS variables`，并保留了 SWR、Zustand、Axios、主题切换和错误兜底这些常用能力。

## 技术栈

- React 19
- TypeScript 5
- Vite 8
- Tauri 2
- shadcn/ui + Radix UI
- Tailwind CSS v4
- SWR
- Zustand
- Axios
- sonner
- oxlint + oxfmt

## 目录结构

```text
src/
├── api/                 # 请求 key 与纯函数 API
├── components/
│   ├── ErrorBoundary.tsx
│   └── ui/              # shadcn/ui 基础组件
├── hooks/               # 组合 hooks（如 toast）
├── lib/
│   ├── http.ts          # Axios 客户端
│   ├── toast.ts         # sonner 封装
│   ├── utils.ts         # cn 等工具函数
│   └── stores/          # Zustand stores
├── pages/               # 页面组件
├── providers/           # Theme / SWR Provider
├── router/              # 路由配置
├── styles/              # reset、Tailwind、设计令牌
├── types/               # 类型定义
├── App.tsx
└── main.tsx
src-tauri/                 # Tauri 2 桌面端壳、权限、图标与打包配置
```

## 快速开始

```bash
pnpm install
pnpm dev
```

默认开发地址：`http://localhost:5173`

桌面端开发需要本机安装 Rust 和平台构建工具：

```bash
pnpm tauri:dev
```

Tauri 开发模式会固定使用 `http://127.0.0.1:1420` 作为 Vite dev server，避免桌面壳连接到 Vite 自动切换后的端口。

## 常用命令

| 命令               | 说明                        |
| ------------------ | --------------------------- |
| `pnpm dev`         | 启动开发服务器              |
| `pnpm dev:tauri`   | 启动 Tauri 专用 Vite 服务器 |
| `pnpm build`       | 构建生产产物                |
| `pnpm preview`     | 预览构建结果                |
| `pnpm tauri:dev`   | 启动桌面端开发模式          |
| `pnpm tauri:build` | 构建桌面端安装包            |
| `pnpm lint`        | 执行 oxlint                 |
| `pnpm lint:fix`    | 自动修复 lint 问题          |
| `pnpm format`      | 检查格式                    |
| `pnpm format:fix`  | 自动格式化                  |
| `pnpm check`       | 执行 lint + format          |
| `pnpm check:fix`   | 执行 lint:fix + format:fix  |

## 请求层约定

模板里的请求模块统一采用 “`key + pure function`” 形式，便于 SWR 复用和测试。当前示例接口是本地 mock，但组织方式和真实请求保持一致。

```ts
export const demoKey = "/api/demo";

export async function getDemo() {
  return {
    message: "SWR cache 已同步完成",
    timestamp: new Date().toLocaleString("zh-CN"),
    count: Math.floor(Math.random() * 100),
    status: "success",
  };
}
```

页面消费时直接复用导出的 key 和请求函数：

```tsx
const { data, isLoading } = useSWR(demoKey, getDemo);
```

当前示例可参考：

- `src/api/demo.ts`
- `src/api/auth.ts`
- `src/api/users.ts`

## UI 与主题

- `src/components/ui/*` 提供模板内置的 shadcn/ui 组件
- `src/providers/ThemeProvider.tsx` 负责同步 light / dark 主题
- `src/styles/index.css` 是样式入口，负责串联 reset、tokens 与 Tailwind
- `src/styles/tokens.css` 是唯一 design token 源
- `src/styles/tailwind.css` 负责 Tailwind v4 的 `@theme inline` 映射与全局样式层
- `src/lib/toast.ts` 封装 `sonner`，避免页面直接依赖第三方通知 API

## 说明

这是模板仓库，不内置项目级 CI、Changesets、commitlint、Docker Compose 或发布流程。相关内容由 `one-cli` 在工作区层统一生成和治理。
