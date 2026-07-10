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

激活时客户端上报设备指纹（来自 license 目录下持久化的随机 `device-id`），license server 把它写进签名 token 的 `device_hash`。之后**换取 pack 解密密钥时,客户端带上当前设备指纹,server 校验其与 token 中的 `device_hash` 一致**;不一致返回 403（错误码 40314）。这样把已激活的 `license.json` 拷到别的机器就换不到密钥、导入不了 Pro 包。

- 客户端本地也会先校验(离线即拦),server 端校验是权威(改客户端也绕不过——除非篡改二进制伪造指纹,属可接受残留)。
- `device_hash` 为空的 token 视为**不绑定**(便于团队/浮动授权场景)。
- 与"传激活码"不同:激活码可被多设备使用,受 `max_activations` 次数限制;设备绑定针对的是"传已激活凭证"。

## 密钥与信任

- **Pack 解密密钥**（AES-256-GCM，32 字节）：由 license server 在授权校验后按 `keyId` 下发。开发期通过 `MEDIAGO_LICENSE_PACK_KEYS` 环境变量模拟。
- **发布者签名公钥**（Ed25519，32 字节）：验证 `.mgpackpro` 的 `signature.json`，防止持有对称密钥的用户伪造/篡改包。公钥可公开，随客户端分发或由 license server 下发；开发期通过 `MEDIAGO_LICENSE_PUBLISHER_KEYS` 模拟。
- **签名私钥**：只存在于私有 pack-builder 侧，绝不进入本仓库。
