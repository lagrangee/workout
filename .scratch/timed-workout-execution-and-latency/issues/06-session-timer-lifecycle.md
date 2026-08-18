# 06 — Session 计时生命周期与离开执行面

**What to build:** 让 Workout Session 的累计时长只覆盖 Athlete 可见且未暂停的执行时间；页面隐藏、pagehide、离开执行面和打开结束表单都必须结束当前 Training Interval，回到执行面后由 Athlete 显式继续。

**Blocked by:** 02 — 固定时长 Completion Item 执行闭环

**Status:** resolved

- [x] 服务端提供幂等 `pause` / `resume` 命令；暂停保留 `in_progress` 但关闭开放区间，继续创建新的开放区间。
- [x] pagehide、visibility loss、返回今日/切换页面和结束表单都会停止客户端计时并同步服务端暂停边界。
- [x] 重新打开仍在进行中的 Session 时不会继续累计；界面显示“继续”，只有显式继续才恢复动作、休息和 Session 计时。
- [x] 结束已暂停 Session 不要求额外确认，且不会把暂停或离开网页的时间写入训练时长。
- [x] 浏览器 seam 和 HTTP contract 覆盖隐藏时间排除、区间切分、暂停后结束，以及动作计时和休息计时的暂停/恢复。
