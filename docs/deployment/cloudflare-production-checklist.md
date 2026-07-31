# Cloudflare production checklist

这份清单是 ticket 24 的可执行边界。它把本地代码/配置检查和需要账户 owner 现场确认的 Cloudflare 状态分开；本地通过不代表 production gate 已通过。

## 已由仓库约束的配置

- `wrangler.toml` 固定单 Worker + Static Assets + D1，并将 `workers_dev` 与 `preview_urls` 设为 `false`。
- 私有 API 从 Worker 签发的 HMAC 会话 Cookie（或显式 Bearer 会话）派生 Athlete，不接受 URL 或 body 中的 Athlete ID；Worker 独立校验签名、版本、签发时间、过期时间和当前配置的邮箱。
- Coach 路由只读且 bearer 错误统一为 `404`；私有与 Coach 响应带 `Cache-Control: no-store`、`Referrer-Policy: no-referrer`、`X-Robots-Tag: noindex`，应用层不输出 token-bearing URL 日志。
- `migrations/0001_initial.sql`、`0002_state_revision.sql`、`0003_query_indexes.sql` 与 `0004_restore_session_date_guard.sql` 覆盖 Athlete state 的唯一 email、初始化、乐观并发版本边界、Session 日期唯一性，以及 Plan/Session/Exercise/Coach digest 查询投影；D1 binding 名为 `DB`。
- 会话签名材料或任一密码 Secret 缺失时 Worker fail-closed；本地未签名身份只能通过显式 `LOCAL_AUTH=true` 测试入口，不能由 development/production 默认开启。
- Athlete Export 在发送下载 headers 前检查 10,000 Sessions / 20 MiB 容量上限。

## 发布前必须由 owner 现场确认

1. 通过 Cloudflare Worker Secrets 写入两条准确的 normalized email、两个独立密码和随机 `AUTH_SESSION_SECRET`；禁止把这些值写入仓库或 GitHub Actions 日志。
2. 通过登录接口分别验证两个邮箱；会话 Cookie 为 `HttpOnly`、`Secure`、`SameSite=Lax`，无效/篡改/过期会话返回 `401`，未配置邮箱返回 `403`。
3. `workout.lagrangee.xyz` 是唯一 production hostname；`workers.dev`、Preview URL 与其他 DNS hostname 均无法到达私有数据。
4. D1 migration 在空的 recovery fixture 上成功；`0003_query_indexes.sql` 的索引投影、`0004_restore_session_date_guard.sql` 的 Session 日期唯一性、Worker/D1 quota、日志/trace redaction、cache bypass 均用非敏感请求复核。
5. 用脱敏 fixture 演练 D1 Time Travel 回滚与 Athlete Export 检查；禁止在演练中读取真实 Athlete 数据。

2026-07-31 的现场证据已补齐：五个 Worker Secret 名称存在（值未读取）、应用登录成功、custom domain `/healthz` 为 `200`、未登录私有边界为 `401`/`302`、生产 seed 已回读，且 synthetic D1 Time Travel/Export recovery rehearsal 已完成并清理临时库。Quota 与日志/trace 的持续运营监控仍属于 Cloudflare 控制台的日常 owner 责任，不是 GitHub Actions release gate。
