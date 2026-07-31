# Cloudflare production checklist

这份清单是 ticket 24 的可执行边界。它把本地代码/配置检查和需要账户 owner 现场确认的 Cloudflare 状态分开；本地通过不代表 production gate 已通过。

## 已由仓库约束的配置

- `wrangler.toml` 固定单 Worker + Static Assets + D1，并将 `workers_dev` 与 `preview_urls` 设为 `false`。
- 私有 API 从 Access assertion 派生 Athlete，不接受 URL 或 body 中的 Athlete ID；Worker 独立校验 issuer、audience、`exp`、`nbf` 与签名。
- Coach 路由只读且 bearer 错误统一为 `404`；私有与 Coach 响应带 `Cache-Control: no-store`、`Referrer-Policy: no-referrer`、`X-Robots-Tag: noindex`，应用层不输出 token-bearing URL 日志。
- `migrations/0001_initial.sql` 与 `0002_state_revision.sql` 覆盖 Athlete state 的唯一 email、初始化与乐观并发版本边界；D1 binding 名为 `DB`。
- Access 签名材料缺失时 Worker fail-closed；本地未签名身份只能通过显式 `LOCAL_AUTH=true` 测试入口，不能由 development/production 默认开启。
- Athlete Export 在发送下载 headers 前检查 10,000 Sessions / 20 MiB 容量上限。

## 发布前必须由 owner 现场确认

1. Zero Trust Free 已 onboarding；只创建两条准确的 normalized email identity，OTP 可用且 seats/quota 足够。
2. Access application 的 audience 与 issuer 写入 secret/vars；account-wide default-deny 生效，exact 与 wildcard `/app`、`/api/private` 均受保护。
3. `workout.lagrangee.xyz` 是唯一 production hostname；`workers.dev`、Preview URL 与其他 DNS hostname 均无法到达私有数据。
4. D1 migration 在空的 recovery fixture 上成功；索引、Worker/D1 quota、日志/trace redaction、cache bypass 均用非敏感请求复核。
5. 用脱敏 fixture 演练 D1 Time Travel 回滚与 Athlete Export 检查；禁止在演练中读取真实 Athlete 数据。

这些现场状态未在本地仓库中伪造为“已通过”。缺失任何一项时，ticket 24 / release acceptance 保持 `blocked: production-owner-evidence-required`。
