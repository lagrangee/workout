# 01 — Workout Session 操作的即时反馈

**What to build:** 让 Athlete 在 Today 执行面操作 `开始训练`、继续、重启和保存 Completion Item 时，立即看到操作已被接收，并在成功后直接进入或更新当前 Workout Session。成功的服务端 mutation 返回值应直接成为当前 Session 状态，不再让 Athlete 等待一次多余的详情读取。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] 在 Today 点击 `开始训练` 后立即显示 pending 状态并禁用重复操作；成功后无需刷新即可进入 Workout Session 执行面。
- [x] 继续、重启和 Completion Item 保存都具备一致的 pending、禁用和成功反馈，重复点击不会产生重复 mutation。
- [x] 成功 mutation 直接更新当前执行面；浏览器级验证证明不会再发起多余的 Session 详情读取。
- [x] mutation 失败时恢复可操作状态，显示可重试的错误，并保留 Athlete 尚未保存的实际值或反馈输入。
- [x] pending、loading、disabled、error、focus 状态沿用现有 Today/Session 的按钮、提示和间距语言，在移动端保持可读且操作区域稳定。
