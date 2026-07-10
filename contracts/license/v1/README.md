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
| `POST /api/v1/activate` | 激活码 → 签名 token（token.schema.json 结构；wire 格式 `base64url(payload).base64url(ed25519sig)`） |
| `POST /api/v1/pack-keys/resolve` | Bearer token → 按 `key_id` 下发 pack 对称密钥 |
| `GET /api/v1/publisher-keys` | 受信发布者公钥环 |
| `GET /api/v1/license/public-key` | token 验签公钥（客户端激活时获取并与 token 一起保存本地） |

未配置 `MEDIAGO_LICENSE_SERVER_URL` 时，客户端回退到开发期环境变量授权（见下）。

## 设备绑定

激活时客户端上报设备指纹（来自 license 目录下持久化的随机 `device-id`），license server 把它写进签名 token 的 `device_hash`。换取 pack 密钥时客户端带上当前设备指纹，server 校验其与 token 中的 `device_hash` 一致；不一致返回 403（错误码 40314）。`/api/v1/activate` 要求 `device_hash` 非空，避免签发"无绑定"的万能 token。

**当前强度（务必如实理解，勿夸大）**：这道绑定**只挡住"拷贝 license.json + 运行原版客户端"**这种非技术性共享——原版客户端在新机器上算出的本地指纹不同，本地校验先拦，且上报给 server 的指纹也不匹配。

它**挡不住**稍有技术的复制者：
- `device_hash` 以明文写在 token 里（`base64url(payload)` 可直接解出），所以持有被拷 token 的人能读出 `device_hash`，再手工发一个 HTTP 请求把同一个值回填过去——**server 端校验会通过**。即 server 端校验**并非真正权威**，一条 curl 即可绕过，无需改二进制。
- `device-id` 是明文文件、与 `license.json` 同目录，整目录拷贝会一并带走指纹。

要做到真正防"传已激活凭证"，需要**质询-应答**：激活时客户端生成设备密钥对、只上报公钥（server 把公钥哈希写进 token）；换密钥时 server 下发 nonce，客户端用**设备私钥**签名，server 用绑定的公钥验签。私钥不进 token、不随 `license.json` 传播，一条 HTTP 请求无法伪造。此为待实现项。

- `device_hash` 为空的 token 视为**不绑定**（团队/浮动授权场景，仅限内部/管理签发）。
- 与"传激活码"不同：激活码可多设备使用、受 `max_activations` 次数限制；设备绑定针对的是"传已激活凭证"。

## 密钥与信任

- **Pack 解密密钥**（AES-256-GCM，32 字节）：由 license server 在授权校验后按 `keyId` 下发。开发期通过 `MEDIAGO_LICENSE_PACK_KEYS` 环境变量模拟。
- **发布者签名公钥**（Ed25519，32 字节）：验证 `.mgpackpro` 的 `signature.json`，防止持有对称密钥的用户伪造/篡改包。公钥可公开，随客户端分发或由 license server 下发；开发期通过 `MEDIAGO_LICENSE_PUBLISHER_KEYS` 模拟。
- **签名私钥**：只存在于私有 pack-builder 侧，绝不进入本仓库。
