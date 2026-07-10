# 桌面端 Bundle 热更新架构

> 状态：实现完成、ships dark（默认关闭），见 PR #30。本文描述当前安全边界和发布流程；
> 若代码与本文不一致，应先停止发布并补齐二者，而不是把清单强行推给客户端。

## 1. 目标与边界

MediaGo Drama 的桌面业务由 React renderer 和本地 Go server 共同组成。日常变更经常同时修改
两边，因此热更新的最小发布单元不是单个静态站点，而是一组配套组件：

```
Bundle(rev) = renderer(rev) + mediago-server(rev, platform)
```

一个签名清单一次性声明整组组件，客户端一次性 stage、apply、健康确认或回滚，避免前后端 API
错配。组件内容未变化时可复用当前文件，不重复下载。

本方案覆盖：

- React renderer；
- `mediago-server` 的 macOS ARM64 / Windows x64 二进制；
- additive SQLite schema 迁移（有严格快照与回滚）。

下列变化必须走全量 Electron installer：

- Electron main / preload、原生 Node 模块、壳 API；
- ffmpeg、agent、tools 等 extra resources；
- workspace 文件布局、文件移动/删除、SQLite 之外的持久化迁移；
- 客户端不支持的 `minShellApi`。

热更新并不承诺 server 零中断。立即应用会重启 sidecar 并重载窗口，但 Electron 主进程不退出；
默认路径仍是下载后下次启动生效。

## 2. 三类版本，不能混用

`apps/workspace/bundle-update.json` 是发布 PR 中必须显式 review 的版本契约：

```json
{
  "bundleRev": 1,
  "schemaVersion": 1,
  "workspaceLayoutVersion": 1
}
```

| 字段                     | 含义                        | 热更新规则                                     |
| ------------------------ | --------------------------- | ---------------------------------------------- |
| `bundleRev`              | renderer/server 配套版本    | cohort 内严格递增                              |
| `schemaVersion`          | SQLite schema 世代          | 不可下降；目标高于当前时必须先快照             |
| `workspaceLayoutVersion` | SQLite 之外的持久化文件布局 | 必须等于安装包内置版本；变化先发全量 installer |

这取代了人工勾选 `hasMigration`。例如客户端从 rev 6 直接跳到 rev 8，只要
`schemaVersion(8) > schemaVersion(6)` 就一定拍快照，不会因为 rev 8 自己“没有 migration”而漏掉
rev 7 的 schema 变化。

`workspaceLayoutVersion` 不负责回滚文件系统迁移，而是明确禁止它们穿过热更新边界。新布局先随
全量安装包落地；旧安装包看到更高 layout version 会显示“需要全量更新”，不会执行新 server。

## 3. cohort：channel 与 edition 同时隔离

安装包在 `bundle-meta.json` 中固化 `channel` 和 `edition`。全量更新与 bundle 热更新分别使用固定
cohort tag：

```
desktop-<channel>-<edition>   # 全量安装包 + electron-updater YAML + cohort proof
bundle-<channel>-<edition>    # renderer/server ZIP + 签名 manifest

例如：desktop-beta-community、bundle-beta-community
```

签名 payload 自身也必须携带相同的 `channel`、`edition`；URL、tag 与 payload 三者任一不一致即
拒绝。这样 community 清单不能改变 Pro 安装包的 renderer gating，反之亦然。

## 4. 签名清单与内容身份

发布物包含：

```
renderer-<rev>.zip
server-<rev>-darwin-arm64.zip
server-<rev>-windows-x64.zip
bundle-manifest.json        # payloadB64 + Ed25519 signature
```

清单中的每个组件有两种哈希：

- `sha256`：压缩包字节哈希，下载时流式校验；
- `contentSha256`：解压后真实内容身份，用于组件复用和每次执行前的磁盘完整性校验。

renderer 内容哈希按 POSIX 相对路径代码点排序。每个 path 和文件内容都先写入 8-byte big-endian
长度，再写原始 bytes；这种 length-prefix framing 不会产生路径/内容边界碰撞。哈希排除
`bundle-meta.json`、`renderer-meta.json` 与顶层 `bin/`；server 内容哈希就是原始二进制 SHA-256。
ZIP 条目顺序、权限和 DOS 时间固定，因此相同输入的 archive hash 也可复现，但运行时身份不依赖
ZIP 元数据。

安全边界：

- 清单使用 Ed25519 签名，私钥只存在 GitHub Actions Secret，客户端只内置公钥；
- 组件 URL 仅允许 HTTPS；本地测试模式只额外允许 loopback HTTP；
- 下载校验 archive hash 和 size，解压拒绝绝对路径、`..` 与 zip-slip；
- stage 后写入内容身份，每次执行下载 bundle 前重新计算，磁盘被篡改则隔离该 rev；
- macOS server 在配置证书时使用 Developer ID 签名并公证。

## 5. 磁盘状态与 Last Known Good

```
<userData>/bundle/
├── active.json                 # 原子写的状态机、LKG、回滚意图、kill-switch 缓存
├── versions/<rev>/
│   ├── index.html + assets/
│   ├── bin/mediago-server[.exe]
│   └── bundle-meta.json
├── db-snapshots/<rev>/         # temp 完成后原子发布的 SQLite 快照集合
├── tmp/
└── runtime-info.json           # server 报告的 DB 路径缓存
```

状态机显式区分：

- `active`：下一次/当前准备执行的版本；
- `lastKnownGood`（LKG）：renderer 与 server 均通过身份绑定健康检查的版本；
- `pending`：已 stage、尚未成为 LKG；
- `rollbackPending`：失败 rev、目标 LKG 与是否需要恢复快照的持久化意图；
- `migrationStarted`：forward-schema 子进程可能已经执行 migration/watcher/worker 的持久化边界；
- `channelDisabled`：最近一次有效签名清单下发的 cohort kill-switch；
- signed-manifest high-water 与 `bundleRev` floor：都绑定 channel/edition，切换 cohort 时清空；schema/layout
  floor 绑定同一 userData，跨 cohort 仍不允许倒退。

只有“双健康”才能推进 LKG。下载另一个版本不会把尚未运行的 pending 版本当作 LKG；已有 pending
时也不会被后续检查静默覆盖。全量安装包内置的 rev 更新后，若它不低于下载指针，客户端以新的
builtin 为基线并清理陈旧 pending，避免安装 rev 8 后误把 rev 6 当成可应用更新。

## 6. 启动、stage、apply

### 6.1 启动

单实例锁成功后才允许任何副作用：

1. 读取并校验 builtin meta、状态文件和候选下载目录；
2. 若有 `rollbackPending`，先重试完整恢复，成功后才清除意图；
3. 从 active/LKG/builtin 选择可执行版本；被禁用、拉黑、超预算或内容损坏的版本不可执行；
4. 目标 `schemaVersion` 高于当前时，严格创建 DB 快照；任何 DB 源缺失、复制或原子发布失败都
   fail closed，目标版本不会获得 boot attempt、也不会启动；
5. 安全准备完成后才记 boot attempt；forward-schema 版本在 spawn **之前**持久化
   `migrationStarted`，再启动 sidecar。

连续两次启动没有“双健康”时，同 schema 或尚未开始 forward migration 的 pending rev 会被拉黑并
回到真实 LKG（它可能是下载版本，也可能是 builtin）。若 `migrationStarted=true`，则不会把旧 binary
放到可能已升级的数据上，而是 fail closed，等待同 schema 重试或兼容完整安装包。

### 6.2 下载与 stage

1. 拉取 cohort manifest，验签后再解析 payload；
2. 校验 `bundleRev`、shell API、schema/layout、channel/edition 和目标 platform；
3. 从 `/api/v1/runtime/activity` 刷新 DB 路径；查询失败按 busy/fail closed 处理；
4. 仅下载 `contentSha256` 与当前不同的组件；其余从当前自包含版本复制；
5. 在临时目录验 archive、解压、验 content，最后原子 rename 为 `versions/<rev>`；
6. 在一个 store 写入中标记 pending，不改变 LKG。

### 6.3 立即应用

检查与 apply 共用进程内互斥锁；锁在第一次 `await` 之前获取，并在锁内重读 store，因此双击
Apply 或 check/apply 交错不会同时改指针、快照或 sidecar。

立即应用流程：

1. activity 必须 idle；除持久化任务/agent run 外，provider 调用还有内存 in-flight counter，覆盖
   “请求尚未结束、任务行尚未写入”的窗口；
2. 通过 stdin 请求旧 server `http.Shutdown`，等待排空；
3. 若 grace period 后仍存活会发送 `SIGKILL`（Windows 使用等价强制终止），并等待确认退出；若
   仍无法确认退出，apply 中止，绝不在可能仍有 writer 时恢复 DB 或启动第二个 server；
4. 创建所需快照、持久化 rollback intent；forward-schema 版本在 spawn 前再持久化
   `migrationStarted`，然后启动新 sidecar；
5. readiness 通过后标记 server healthy，切换 renderer 并重载窗口；
6. 新 renderer beacon 到达且身份匹配后，pending 转为 LKG。

这不是“绝不硬杀”。真实策略是先优雅排空、超时后强制终止、必须确认旧进程退出后才继续。

## 7. readiness 不是固定端口上的任意 2xx

每次 Electron 启动 sidecar 都生成一次性 instance token，并通过环境变量传入：

- 期望的 `bundleRev`；
- 期望的 `schemaVersion`；
- 随机 `instanceToken`。

`/api/v1/health` 只有在 workspace/settings repository 初始化和 migration 均成功时才返回 ready；
响应同时回显上述三个字段。Electron 必须验证全部字段，因此固定端口上残留的旧 server 或其他
进程返回 200 也不能让新版本转正。

sidecar 的 `error`/`exit` 事件绑定具体 child 实例。全局 child 引用只在确认该实例退出时清除，旧
实例迟到的 `exit` 不会把新 child 清空。

## 8. DB 快照与可重入回滚

SQLite 快照只在 server 完全停止时进行。快照要求所有声明的 DB 主文件存在；先复制到临时目录，
写完整 manifest 后再原子 rename。WAL/SHM 的处理失败即停止，不再继续复制一个不一致的集合。

恢复前先持久化 `rollbackPending`。每个 live DB 先写 sibling temp，再原子替换；多 DB 之间无法由
文件系统提供单事务原子性，所以进程崩溃后仍保留 intent，下次启动会从同一快照重放全部替换。
只有恢复完全成功才切指针并清除 intent。

只要 forward-schema server **开始 spawn**，migration、workspace watcher 或 generation worker 就可能已写入
真实数据；不能把 `/health ready` 当作“首次可能写”的边界。因此 `migrationStarted` 一旦落盘，即使
server 尚未 ready、renderer load/beacon 失败或客户端随后收到 kill-switch，也绝不自动恢复启动前快照。
客户端只会重试同一 schema，或等待 schema/layout 兼容的完整安装包接管；达到重试预算后 fail closed。
只有在子进程尚未开始、且 rollback marker/快照事务能完整完成时，才允许恢复快照并启动旧 binary。

## 9. 签名 kill-switch

payload 的 `disabled: true` 是 cohort 级 kill-switch。客户端只接受签名且 cohort 匹配的 disabled
清单，收到后把 `channelDisabled` 持久化并隔离已下载 active/pending 版本，回到 builtin/LKG 安全
路径。该缓存让后续离线启动仍保持禁用，不会因为拉不到网络又执行已撤回二进制。

重新启用必须发布更高 `bundleRev` 的有效签名清单；不能通过删除远端 asset 清除本地安全状态。

## 10. 发布与 CI

### 10.1 PR 门禁

`.github/workflows/bundle-hot-checks.yml` 在相关 PR 和 `dev` push 上运行：

- Electron TypeScript compile；
- policy/store 状态机测试；
- Go `-race` 测试（包括 readiness/activity）；
- hot-update 源码 format/lint；
- 实际 package smoke test，并对同一输入打包两次比较所有产物 hash。

手工发布 workflow 重复关键门禁，避免绕过 PR checks 的 dispatch 直接出包。

### 10.2 Bundle Hot Release

`.github/workflows/bundle-hot-release.yml` 的输入包括 channel、edition、schema version、workspace
layout version 与 disabled。workflow 会：

1. 校验输入版本与 `bundle-update.json` 精确一致；
2. 强制查询已公开的 `desktop-<channel>-<edition>/desktop-cohort-meta.json`，验证 cohort、layout、
   builtin rev、source commit、`hotUpdateEnabled` 与 Ed25519 公钥；不存在或不匹配都会失败，人工勾选
   不能替代发布证据；
3. 校验 hot rev 严格递增、schema/layout 不下降，并基于上一个签名 manifest 的 `sourceCommit`
   自动检查 schema/layout 敏感源码是否同步 bump；若 full installer 之后仍有 Electron shell 或
   extra-resource 变化，也会拒绝热更；
4. 构建 renderer 和两平台 server，签名/公证 macOS 二进制，生成可复现 ZIP 与签名清单；
5. 首次 cohort release 先建 draft，ZIP 全部成功后才上传 `bundle-manifest.json`，最后公开；已有
   release 也始终 manifest-last。替换前把当前签名指针保存为 `bundle-manifest-backup.json`；若
   GitHub 的 delete/upload 在中间失败，下一次运行用该已验签备份继续做单调性检查并修复指针。
   中断重跑可覆盖尚未被 manifest 引用的同 rev ZIP。

若 manifest 已经成功移动、但 job 在最终回执前中断，重跑会验签并核对同 rev 的 source、cohort、
schema/layout、disabled、full baseline 和全部组件 asset；完全一致就按“已提交”成功结束，不会要求
伪造新 rev，也不会重新上传不同字节。

### 10.3 Full Electron Release

`.github/workflows/electron-release.yml` 明确选择 channel 与 edition，并把它们传入 renderer build 和
stage，使安装包的 builtin meta 固化正确 cohort、schema 和 layout。每个 cohort 发布到固定
`desktop-<channel>-<edition>`，避免相同 SemVer 的 community/pro 或 alpha/beta 互相覆盖。
Electron main 必须据 builtin meta 把 `electron-updater` 的 generic feed 指向该固定 tag；不能继续让
GitHub provider 从全仓库 release 列表自动挑版本，否则 edition 隔离只存在于发布端。
这两类固定 cohort release 必须保持 mutable；workflow 会拒绝 GitHub 的 immutable release，因为
固定 tag 的 YAML/manifest 指针需要原位推进。

发布顺序是版本化 installer/blockmap → electron-updater YAML → `desktop-cohort-meta.json`。首次发布在
全部资产到齐前保持 draft；更新已公开 cohort 时，proof 最后移动，因此工作流中断只会暂时阻止后续
hot release，不会把半套安装包证明为可用。proof 自身也保留上一次 backup 供同版本重跑修复。
全量和热更 workflow 只能从 `dev` dispatch，使用
`production-release` Environment；两者共用 cohort 级 concurrency lock，不能交错移动 full proof 和
hot manifest；Windows job 不注入 Apple secrets。

electron-builder publisher 显式使用 cohort channel，因此 beta/alpha 产物分别是 `beta.yml` /
`beta-mac.yml`、`alpha.yml` / `alpha-mac.yml`；installer 文件名固定为无空格的
`${name}-${version}-${os}-${arch}.${ext}`。发布前和 hot guard 都解析 YAML 的 `path/url`，确认它引用
的 basename 确实已上传。Full release 还会验签当前 hot manifest，禁止 builtin rev/schema/layout
低于已发布 hot floor；同 app version + source 的 canonical proof 若完全相同则 no-op，不允许重签后
clobber 成另一套同版本资产。

## 11. 开闸顺序

`hotUpdateEnabled` 和空公钥让功能默认不发网络请求。生产开闸必须严格按以下顺序：

1. `pnpm bundle:keys` 生成 Ed25519 keypair；私钥写入 GitHub Secret
   `RENDERER_UPDATE_PRIVATE_KEY`，公钥写入 `hot-update-config.ts`；
2. 配置 `production-release` GitHub Environment、macOS signing/notary secrets，并完成 workflow
   演练；
3. 打开公钥和 `hotUpdateEnabled=true` 后，**先走 Full Electron Release**，发布并实际安装一个包含
   新公钥、开关、cohort meta、readiness 协议和版本字段的安装包；旧安装包不能安全消费新清单；
4. 在该安装包上做本地/测试 cohort 的下载、下次启动、立即应用、进程残留、快照失败、断电重启、
   disabled 离线重启和回滚演练；
5. 最后才向同 cohort 的 `bundle-<channel>-<edition>` 发布第一个生产签名 manifest；workflow 会
   重新下载并验证第 3 步的 `desktop-cohort-meta.json`，无法跳过。

不能先发热更新清单再等全量安装包跟上；也不能只打开 main 分支开关而不发 installer。

## 12. 本地测试

在 `apps/workspace` 下运行 `pnpm bundle:local-test`。脚本生成临时 keypair、指向 loopback URL 打包，
并打印 `MEDIAGO_HOT_UPDATE_TEST_URL` / `MEDIAGO_HOT_UPDATE_TEST_PUBKEY` 启动参数；它不修改生产
公钥、不访问 GitHub。

至少覆盖：

- 同 schema 普通升级；
- 跨过中间 rev 的 schema 升级；
- readiness nonce/rev 不匹配；
- snapshot/restore 中途失败并重启重试；
- pending 未运行时又发现新 rev；
- full installer builtin rev 高于旧 active；
- activity busy 与重复点击 Apply；
- disabled 后断网重启。

## 13. 关键文件

| 关注点                         | 文件                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------ |
| manifest/meta/store 契约       | `apps/workspace/electron/src/ipc-contract.ts`                                  |
| 纯策略与兼容判断               | `apps/workspace/electron/src/bundle-policy.ts`                                 |
| LKG、内容校验、快照/回滚       | `apps/workspace/electron/src/bundle-store.ts`                                  |
| 下载/apply/互斥/readiness 编排 | `apps/workspace/electron/src/bundle-updater.ts`                                |
| cohort URL、开关与公钥         | `apps/workspace/electron/src/hot-update-config.ts`                             |
| sidecar 生命周期               | `apps/workspace/electron/src/sidecar.ts`                                       |
| Go readiness/activity          | `services/server/internal/http/handlers/`、`internal/service/runtimeactivity/` |
| 打包签名                       | `apps/workspace/scripts/package-bundle-update.ts`                              |
| 全量安装包 stage               | `apps/workspace/scripts/stage-electron-app.ts`                                 |
| PR/发布门禁                    | `.github/workflows/bundle-hot-checks.yml`、`bundle-hot-release.yml`            |
