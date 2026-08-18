# 03 — 完成后的休息倒计时与音频控制

**What to build:** 让 Athlete 在手动确认 Completion Item 后自然进入该动作配置的休息阶段，同时能够控制训练提示音，而不改变 Session Record 或 Actual Training Data 的含义。

**Blocked by:** 02 — 固定时长 Completion Item 执行闭环

**Status:** resolved

- [x] 服务端确认手动完成后，执行面自动进入配置的 rest countdown，并明确显示当前处于休息状态。
- [x] 休息倒计时可以由 Athlete 主动跳过；最后 5 秒每秒播放一次提示音，并在休息结束时播放独立结束提示。
- [x] 提供始终可发现的 mute 控制；静音会抑制动作和休息的应用提示音，但不改变倒计时、实际值或保存的数据。
- [x] 默认音量遵循设备和浏览器的正常音量控制，不引入第二套独立音量混音器。
- [x] 完成、休息、跳过休息、静音和下一个 focus item 的状态反馈沿用现有 Session UI 语言，在小屏上不遮挡主要操作。
