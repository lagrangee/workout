# 02 — 固定时长 Completion Item 执行闭环

**What to build:** 让固定 `duration_sec` 的 Completion Item 具备完整的动作执行流程：Athlete 点击一次 `开始动作` 即激活音频并进入准备阶段，随后按固定目标倒计时；计时归零只准备结果，不替 Athlete 完成或保存记录。

**Blocked by:** 01 — Workout Session 操作的即时反馈

**Status:** resolved

- [x] `开始动作` 是唯一的音频用户激活边界，并先显示 5 秒准备倒计时，再进入正式动作倒计时。
- [x] 正式动作显示清晰的大号剩余秒数，并在整个固定时长内每秒播放一次节奏提示；最后 3 秒使用增强提示，归零播放特殊结束音。
- [x] 计时归零后停止动作计时，预填固定目标对应的实际 duration_sec，但 Completion Item 仍未完成、未写入 Actual Training Data。
- [x] Athlete 可以修改实际值，并且只有显式点击 `完成` 后才创建或更新 Completion Item 结果。
- [x] 计时暂停时同步暂停动作倒计时、节奏音和显示的 Session timer；继续时从剩余时间继续，不重新开始。
- [x] 执行面只使用 Training Plan Snapshot 的固定值；不提供 range 选择，legacy range-shaped duration 使用既有 canonical maximum。
- [x] 倒计时、动作按钮、实际值输入和错误反馈沿用现有 focus surface 的视觉层级、按钮语义、响应式布局和可访问焦点状态。
