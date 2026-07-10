# License contract v1

本目录是开源应用与私有 license server 之间的**版本化授权合约**。License Server 不跟随开源代码实现，只跟随这份合约。

## 三层模型

| 层 | 定义位置 | 示例 |
|----|----------|------|
| feature | 开源代码里的功能开关 | `promptpack.pro-import` |
| entitlement | 授权权益（token 中下发） | `pack.import.pro` |
| plan | 商业套餐（仅 license server 关心） | `pro` / `team` / `enterprise` |

**客户端只判断 entitlement，绝不判断 plan。**

## 文件

- [`features.yaml`](features.yaml) — 可授权功能清单：feature id → required_entitlement 映射。
- [`token.schema.json`](token.schema.json) — 激活后 license server 签发的授权 token 结构。

## 兼容规则

1. 老客户端 + 新 license server：**必须兼容**。server 不得撤销已发布 entitlement 的语义。
2. 新客户端 + 老 license server：新功能禁用，但**不能崩**。
3. 未知 feature id：license server 忽略或返回 unsupported。
4. 未知 entitlement：客户端一律当作**没有权限**。
5. 删除/重命名 entitlement 属于破坏性变更 → 升级合约版本（`contracts/license/v2/`），v1 保留。

## 新增付费功能的流程

1. 本仓库：在 `features.yaml` 新增 feature 条目（id、required_entitlement、introduced_in）。
2. 本仓库：客户端/服务端按 entitlement 做 gating（参考 `services/server/internal/service/license`）。
3. license server（私有仓库）：增加 entitlement 映射；套餐配置决定哪些 plan 拥有它。
4. 集成测试：激活 → 授权 → 加载 → 无权限降级。
5. 发布顺序：**先 license server，再新版客户端**。

## License Server 接口（v1）

客户端通过 `MEDIAGO_LICENSE_SERVER_URL` 指向授权服务器后，走以下接口（响应为 `{code,message,data}` 信封）：

| 接口 | 说明 |
|---|---|
| `POST /api/v1/activate` | 激活码 + 设备公钥 → 签名 token（token.schema.json 结构；wire 格式 `base64url(payload).base64url(ed25519sig)`） |
| `POST /api/v1/pack-keys/challenge` | Bearer token → 一次性设备质询（server 签名，含 nonce） |
| `POST /api/v1/pack-keys/resolve` | Bearer token + `challenge` + `device_signature` → 按 `key_id` 下发 pack 对称密钥 |
| `GET /api/v1/publisher-keys` | 受信发布者公钥环 |
| `GET /api/v1/license/public-key` | token 验签公钥（客户端激活时获取并与 token 一起保存本地） |

未配置 `MEDIAGO_LICENSE_SERVER_URL` 时，客户端回退到开发期环境变量授权（见下）。

## 设备绑定（质询-应答）

采用**质询-应答**，绑定的是"持有设备私钥的证明"，而非 token 里可读出的明文值：

1. **激活**：客户端本机生成 Ed25519 **设备密钥对**，只把**公钥**随 `activation_code` 上报；server 把公钥写进签名 token 的 `device_public_key`。**私钥永远留在本机**（`<license 目录>/device-key`，0600），不进 token、不随 `license.json` 传播。`/api/v1/activate` 要求 `device_public_key` 非空，避免签发"无绑定"的万能 token。
2. **换密钥**：客户端先 `POST /pack-keys/challenge` 取一个 server 签名的一次性质询（含随机 nonce，2 分钟有效）；用**设备私钥**对质询整串签名；`POST /pack-keys/resolve` 带上 `challenge` + `device_signature`。server 校验质询由本 server 签发且未过期、`license_id` 与 token 一致、签名由 token 绑定的公钥所验。任一不过返回 403（40114 质询缺失/无效，40314 设备不符）。

**为什么真正有效**：换密钥要验证的是"对一个**每次都新**的 nonce 的签名"，而签名必须用**不在 token 里**的设备私钥。所以——

- 拷贝 `license.json`（只有 token、公钥）到别的机器：没有私钥 → 签不出质询 → **拿不到密钥**。一条 curl 回填 token 里的值也没用（那只是公钥，签名仍缺私钥）。
- 抓到一次合法签名去重放：下一个 nonce 变了 → 旧签名对不上 → 失败。

已用真实服务 E2E 验证：合法设备 200；伪造签名 403；重放旧签名 403。

**残留（诚实说明）**：仍是软件方案。若把**整个 license 目录**（含 `device-key` 私钥文件）一并拷走，则私钥也被带走 → 可用。要连这个都堵死需把私钥放进 **OS 钥匙串 / 安全芯片**（Keychain/TPM），让私钥读不出——后续可选加固。

- `device_public_key` 为空的 token 视为**不绑定**（团队/浮动授权，仅限内部/管理签发，公开 `/activate` 不签发）。
- 与"传激活码"不同：激活码可多设备使用、受 `max_activations` 次数限制；设备绑定针对的是"传已激活凭证"。

## 密钥与信任

- **Pack 解密密钥**（AES-256-GCM，32 字节）：由 license server 在授权校验后按 `keyId` 下发。开发期通过 `MEDIAGO_LICENSE_PACK_KEYS` 环境变量模拟。
- **发布者签名公钥**（Ed25519，32 字节）：验证 `.mgpackpro` 的 `signature.json`，防止持有对称密钥的用户伪造/篡改包。公钥可公开，随客户端分发或由 license server 下发；开发期通过 `MEDIAGO_LICENSE_PUBLISHER_KEYS` 模拟。
- **签名私钥**：只存在于私有 pack-builder 侧，绝不进入本仓库。
