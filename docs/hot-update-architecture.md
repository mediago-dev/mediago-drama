# 桌面端热更新架构(Bundle 热更)

> 状态:实现完成、ships dark(默认关闭),见 PR #30。本文自包含:讲清楚**现在怎么实现的**、
> **还有哪些方案**、以及**在每个岔路口为什么这么选**。既是设计说明,也是维护参考。

## 0. 背景与目标

桌面端(`apps/workspace` 的 Electron 壳)之前有两条更新通道:

- **全量更新**(electron-updater,PR #18):下整包、走安装器、冷启动。能更新一切,但重。
- **渲染层热更新**(PR #21):只热更 React 界面,几 MB、不重装。但覆盖不了 server。

问题:mediago-drama 的日常改动**经常牵扯 Go server**(`services/server` 的 `mediago-server`
二进制)。渲染层单独热更解决不了真实需求,而全量更新对"改一行 server 逻辑"又太重。

**本方案目标**:让"渲染层 + Go server"的改动也能**不重装、不冷启动**地更新——默认下次打开生效,
server 空闲时可"立即应用"(只重启 sidecar 子进程 + 重载窗口,Electron 主进程不退出)。

**明确的非目标**:

- ❌ 零中断实时热替换。Go server 是编译型二进制,进程必须重启一次;做不到"用户无感换后端"。
- ❌ 更新 Electron 壳 / main.js / preload / 原生 node 模块 / ffmpeg 等 CLI —— 仍走全量(#18)。

## 1. 核心模型:Bundle = 渲染层 + server 二进制(配套版本对)

整套系统的地基:**把 React 界面和 `mediago-server` 二进制打成一个"配套的版本对"(`bundleRev`),
一起下载、一起生效、一起回滚。**

为什么配对而不是两条独立通道:前后端之间有约 160 条 HTTP API 契约
(`services/server/internal/http/routes/routes.go`)。分开更新会导致版本错配(前端调了新 API、
后端没跟上)。配成一对,一个 `bundleRev` 管两个组件,永远配套,这个问题从根上消失。

代价("只改 server 也要带上 renderer 的引用")靠**按组件哈希只下载变化的组件**降到最低。

## 2. 完整生命周期

四个阶段,分布在 Electron 主进程(`electron/src/bundle-*.ts`)与 Go server 两侧。

```
① 启动加载 ───────────────────────────────────────────────────
  单实例锁拿到后 → prepareActiveBundle()          [bundle-updater.ts]
    ├─ 关闸/未打包 → 内置(asar 里 renderer + Resources/bin 的 server)
    └─ 开闸 → resolveBundleDir 在 userData/bundle/versions/<rev> 与内置之间决策
              胜出:严格更新 + 兼容 SHELL_API + 未拉黑 + 健康预算内 + 文件完整
    ├─ 启动安全工作(此刻无 server,SQLite 静止):
    │    · 刚被拉黑的版本 且 其 server 从未健康过 → 恢复 DB 快照
    │    · pending 版本首次启动 → 先给 DB 拍快照
    └─ startServerSidecar(选中的二进制路径) → notifyServerStarted()

② 检查(启动 15s 后台静默 + 手动)──────────────────────────────
  拉签名清单(Ed25519 验签 + 结构校验)             [fetchSignedManifest]
    → evaluateBundleManifest 比组件 sha256           [bundle-policy.ts]
      判定:up-to-date / requires-full-update / unsupported-platform / disabled / download
  download 分支:
    从"活着的 server"刷新 DB 路径(/runtime/activity)
    → 只下变化的组件(sha256 校验 + 防 zip-slip)
    → 组装自包含版本目录(没变的组件从当前版本复制进来)
    → activateVersion(标 pending) → 清理旧版本

③ 应用(用户点"立即应用" 或 下次启动)──────────────────────────
  立即应用:                                        [applyNow]
    空闲门控(/runtime/activity 报 busy 就拒)
    → 优雅停旧 server(stdin→http.Shutdown;没停下来就中止,不硬来)
    → 快照 DB → 记一次 boot attempt
    → 起新 server → 轮询 /health
    → 标 server 健康(绑定该 rev)→ 切 current → 窗口重载新界面
    → 新界面 beacon 上报 renderer 健康 → 两个都健康 = 转正
  下次启动:走 ① 的路径自然加载 pending 版本

④ 健康 / 回滚 ────────────────────────────────────────────────
  必须 renderer beacon + server /health 都确认,pending 才转正
  连续 2 次启动没转正 → 拉黑该 rev + 回退指针 +(server 没健康过才)恢复快照
  清单里 disabled 字段 = 远程 kill-switch
```

### 磁盘布局(`<userData>/bundle/`)

```
active.json                — 指针 + 双组件健康状态(原子写)
versions/<rev>/            — 自包含 bundle:
     index.html + assets/…      (renderer)
     bin/mediago-server[.exe]   (该平台 server 二进制)
     bundle-meta.json           (身份:bundleRev / minShellApi / 各组件 sha256)
tmp/                       — 下载 / 解压临时区
db-snapshots/<rev>/        — 某 rev 首次启动前的 SQLite 快照
runtime-info.json          — 缓存的 server 运行时信息(DB 路径),供无 server 的启动路径用
```

## 3. 关键机制与"为什么这么写"

| 机制 | 代码 | 为什么 |
|---|---|---|
| **健康信号绑定 rev** | `markComponentHealthy(…, forRev)` | 后台可能刚 stage 了更新的 rev;不绑定的话,旧版本迟到的健康信号会记到新 rev 头上,坏包白白转正、永不回滚 |
| **DB 快照是唯一的跨迁移回滚** | `snapshotDatabases` / `restoreDatabases` | server 换了,新版可能迁移 schema;迁移跑过后老二进制读新 schema 会崩/坏数据。先快照,回滚=恢复快照 |
| **恢复快照仅在 server 从未健康过时** | `prepareActiveBundle` | 健康跑过的版本写的是真实数据;无条件恢复会抹掉用户在那些会话里写的一切 |
| **空闲门控:server 出数据、客户端做决策** | `/api/v1/runtime/activity` | busy = 非终态生成任务(共享 `IsActiveGenerationStatus` 正面清单 + 6h 时效窗,防孤儿行永久锁死)或活跃 agent run;查询失败按"忙"处理 |
| **只重启子进程** | `stopServerSidecarGracefully` | 编译型二进制没法原地热替换,进程必须重启——但只重启 sidecar + 重载窗口,主进程不退出,这才是"不冷启动" |
| **单实例锁之后才做副作用** | `startApp` 里调 `prepareActiveBundle` | 被 doom 的第二实例不能计 bootAttempts,也不能在主实例 server 运行时拷贝/覆盖 SQLite |
| **退出感知** | `quitting` 标志 | apply 与 Cmd+Q 竞态不再误拉黑健康版本、不在退出中恢复 DB |
| **Ships dark** | `hotUpdateEnabled=false` + 空公钥 | 关闸时加载器透传内置版、不发网络请求,对现有用户零影响 |

### 安全(下载并执行原生代码 = 最高风险面)

- **Ed25519 签名**:清单被私钥签名,app 内置公钥验签;私钥只在 CI Secret,不在发布物里 →
  即便有人能往 release 传文件也伪造不出合法清单。
- **sha256**:每个组件下载时流式校验哈希。
- **HTTPS only**:组件 URL 必须 https(仅本地测试模式放行 127.0.0.1)。
- **防 zip-slip**:解压逐条校验路径,拒绝 `..` / 绝对路径。
- **mac 签名(1A)**:CI 用 Developer ID 签 + 公证 darwin server 二进制,secrets 门控
  (没配就退回 Go 的 ad-hoc 签名,不硬失败)。顺带解决 P0-2(mac 全量自动更新)。

## 4. 其他实现方案(六个岔路口)

这套设计是在六个决策点各选一条得到的。每个点都有别的走法。

### 岔路 1:更新粒度——换多少?

| 方案 | 做法 | 为什么没选 |
|---|---|---|
| 全量更新(electron-updater) | 下整包、走安装器、冷启动 | 太重;作为兜底保留(#18) |
| 纯数据外置(Route B) | 易变逻辑从二进制搬成可下发数据 | 不够:改动常动 server 编译型代码,数据外置只覆盖提示词/配置 |
| 纯远端(Route C) | 逻辑挪云端,本地变瘦客户端 | 不适配:捆了 ffmpeg/CLI、要离线,核心必须本地 |
| **✅ Bundle 热更(本方案)** | 渲染层 + server 二进制配套热swap | 本地优先 + 小更新 + 覆盖日常全部改动 |

### 岔路 2:渲染层与 server——分开还是配对?

- 两条独立通道:各自版本 → 省流量但**前后端版本错配**。
- **✅ 配成一对**:一个 `bundleRev` 管两个组件,永远配套;按组件哈希只下变化的那个。

### 岔路 3:DB 安全——怎么防迁移把数据搞坏?

- 不管 → 坏迁移/回滚损坏用户数据,不可接受。
- 只允许向后兼容迁移、不快照 → 轻但脆弱。
- **✅ 快照 + 只加不减迁移 + 跨迁移禁热更回滚(2A)**。

### 岔路 4:busy 门控——客户端查还是服务端拒?

- **✅ 客户端 check-then-act(现在)**:简单、复用现有 IPC。**代价**:探测到停止之间约 200ms
  窗口,期间起的新任务可能被打断(任务可经 poll-id 恢复,影响有限)。
- 服务端原子 quiesce 端点(更深):server 自己"拒新→排空→退出",无竞态,更正确但要改 server
  生命周期。**已记录为 follow-up,未在本 PR 做。**

### 岔路 5:二进制分发——全量还是差量?

- bsdiff/blockmap 二进制差量:理论上只传变化字节。**没做**:复杂度高,而 82MB→zip 约 35MB
  已可接受,留作未来优化。
- **✅ 整个 server 组件 zip**:简单可靠,配合"只下变化组件"已够省。

### 岔路 6:mac 信任——签名还是硬扛?

- 不签名硬扛:靠"不带 quarantine + chmod + Go 自带 ad-hoc 签名"能跑,但 fiddly。
- **✅ Developer ID 签名 + 公证(1A)**:secrets 门控;顺带解决 P0-2。

## 5. 为什么最终是这套(把约束串起来)

产品形态和改动模式几乎把选择空间逼到唯一解:

1. 本地优先 + 要离线 + 捆了 ffmpeg/CLI → 排除纯远端(C);
2. 改动经常动 server 编译型代码 → 排除纯数据外置(B)和"只渲染层热更"(#21 单独不够);
3. server 是编译型二进制 → 注定重启进程,目标定在"不重装、不冷启动"而非"无感";
4. 前后端强耦合(160 路由)→ 必须配对成 bundle,而非两条独立通道;
5. server 有本地 SQLite 用户数据 → 必须有快照回滚,这是它和渲染层热更**本质的区别**;
6. 已有 #21 基建 → 策略层/store/健康/回滚/签名/管线约 80% 复用,增量主要是"多组件 +
   二进制处理 + DB 安全 + mac 签名"。

**行业验证**:这正是 VS Code(语言服务器按需下载到可写目录、当子进程拉起)和 Chrome
(Component Updater:签名组件下到可写目录、运行时加载,独立于浏览器本体)的形状。成熟模式,非新发明。

## 6. 清醒接受的代价(诚实)

- busy 门控的 ~200ms 竞态(已记录待深修:server 端原子 quiesce)。
- 只改 server 时仍整份复制渲染层到新版本目录(为保持"版本目录自包含"接受;可用 APFS clone 优化)。
- 编译型 server 无法真正"无感",总要重启一次进程。

## 7. 发布与开闸

### 打包管线

- `.github/workflows/bundle-hot-release.yml`(macos-14):双平台交叉编译 → darwin
  codesign+notarize(cert/notary secrets 分别门控)→ `package-bundle-update.ts` 签名多组件清单
  → 上传固定 `bundle-<channel>` tag(zip 追加、`bundle-manifest.json` 唯一可变)。rev 单调守卫;
  **edition 为必选输入**(热更渲染层与安装包版本必须一致,否则 Pro 用户会被降级)。
- `.github/workflows/electron-release.yml`:darwin 腿在 macos-14,secrets 门控签名。

### 开闸三步(合并后)

1. `pnpm bundle:keys` 生成 Ed25519 密钥对;私钥入 Secret `RENDERER_UPDATE_PRIVATE_KEY`,
   公钥填入 `electron/src/hot-update-config.ts` 的 `bundleUpdatePublicKey`,`hotUpdateEnabled=true`。
2.(推荐)配 mac 签名 secrets:`MACOS_CERT_P12` / `MACOS_CERT_PASSWORD` +
   `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`。
3. 日常发版:改代码 → PR 里 bump `apps/workspace/bundle-update.json` 的 `bundleRev` → 合并 →
   触发 "Bundle Hot Release"(选对 edition + 有迁移则勾 has_migration)。

### 本地离线测试

`pnpm bundle:local-test`(在 `apps/workspace`):生成临时密钥、打包签名指向 127.0.0.1、起本地
服务器、打印带 `MEDIAGO_HOT_UPDATE_TEST_URL` / `_PUBKEY` 的启动命令。不碰生产配置、不碰 GitHub。

## 8. 关键文件索引

| 关注点 | 文件 |
|---|---|
| 纯决策逻辑(可单测) | `apps/workspace/electron/src/bundle-policy.ts` |
| 文件系统层(版本目录/快照/健康态) | `apps/workspace/electron/src/bundle-store.ts` |
| 编排(检查/下载/应用/回滚) | `apps/workspace/electron/src/bundle-updater.ts` |
| 开关 + 信任锚 | `apps/workspace/electron/src/hot-update-config.ts` |
| 契约(通道/DTO/平台常量/SHELL_API) | `apps/workspace/electron/src/ipc-contract.ts` |
| sidecar 启停 | `apps/workspace/electron/src/sidecar.ts` |
| 忙/闲聚合(业务规则) | `services/server/internal/service/runtimeactivity/report.go` |
| activity 端点 | `services/server/internal/http/handlers/runtime_activity.go` |
| 打包签名 | `apps/workspace/scripts/package-bundle-update.ts` |
| UI | `apps/workspace/src/domains/settings/components/UpdatesPanel.tsx` |
