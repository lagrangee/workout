# D1 Time Travel 与 Athlete Export recovery rehearsal

MVP 没有 restore UI、R2 backup 或 offline queue。恢复演练只验证 operator 能从 D1 Free Time Travel 找回一份脱敏 fixture，并用 Athlete Export 核对关系完整性。

## Runbook

1. 创建与 production schema 相同的临时 D1 database，按顺序运行 `migrations/0001_initial.sql` 至 `0004_restore_session_date_guard.sql`。
2. 写入两条 synthetic Athlete state；不得复制真实 email、Coach Share、token digest、ciphertext 或训练内容。
3. 记录一次 state snapshot，模拟一个 plan/session correction，再用 Cloudflare Dashboard 的 D1 Time Travel 选择演练时间点恢复临时库。
4. 在恢复后的临时库上读取一个 Athlete Export fixture，核对：counts 等于 collection 长度；所有 Session、Scheduled Workout、revision 与 snapshot key 可互相解析；`data_as_of` 在所有 collection 中相同。
5. 对导出 JSON 做 forbidden-field scan，确认没有 identity、Coach secrets、内部 ID、telemetry、symptom、goal、route、AI 或 restore/import 字段。
6. 保存仅含 migration version、synthetic row counts、时间点和验证结果的 receipt；销毁临时库。

D1 Time Travel 是 operator recovery boundary，Athlete Export 是数据所有权 artifact；它们都不是应用层自动恢复机制。

本地 seed 验证使用同一 HTTP plan validate → preview → apply 路径；它不是 D1 直写，也不会把 seed 写入 production。
