# 05 — 过期 in-progress Session 的显式收口

**What to build:** 历史日期不应长期显示为 `进行中`。日历检测到过期 `in_progress` Session 时显示 `未完成`，并提供一次明确的整理动作；服务端重新检查过期条件后将记录收口为 `partial`。

**Blocked by:** None

**Status:** resolved

- [x] 日历只在当前已加载范围内发现过期 `in_progress` Session 时，在标题行右侧显示整理按钮。
- [x] 整理按钮不弹确认框，使用 `Idempotency-Key` 调用 `POST /api/private/sessions/normalize-expired`。
- [x] 服务端按 Athlete timezone 重新判断 `scheduled_date < 当前本地日期`，关闭开放 Training Interval，并把 Session 设置为 `partial`。
- [x] 过期收口不会自动设置 `completed`；即使 Completion Items 恰好都有值，也保留为 `partial`，等待 Athlete 后续校正或明确完成。
- [x] 请求幂等、跨 Athlete 隔离，并覆盖当前日期 Session 不受影响的回归测试。

## Comments

- 2026-08-14：采用用户确认的最小交互——本地发现、日历标题行右侧按钮、服务端一次性归一化；不引入 daemon 或额外确认步骤。
