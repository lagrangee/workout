# 04 — Wake Lock 与前后台恢复

**What to build:** 让 Athlete 在可见地执行 Workout Session 时获得平台允许的屏幕保持能力，并在页面隐藏、设备锁定或回到前台时明确处理计时连续性，不对后台运行作出浏览器无法保证的承诺。

**Blocked by:** 02 — 固定时长 Completion Item 执行闭环

**Status:** resolved

- [x] 执行面可见且处于主动执行状态时请求 Screen Wake Lock；前台恢复保持暂停，显式继续后重新请求，并在能力释放时更新界面状态。
- [x] 页面失去 visibility 或设备锁定导致能力中断时，动作计时和提示音进入暂停/可恢复状态，不让 Athlete 错过的后台时间被误记为有效训练时间。
- [x] Wake Lock 不支持、被拒绝或重新请求失败时，显示清晰的 fallback 提示，并保留手动继续执行的路径。
- [x] 浏览器级验证覆盖请求、前台恢复、visibility loss、暂停和继续；自动化结果与真实 iPhone 验收结果分开报告。
- [x] Wake Lock 提示、暂停状态和恢复操作使用现有 notice、按钮、状态标签和移动端布局语言；在无能力环境下也不破坏主要训练操作。
