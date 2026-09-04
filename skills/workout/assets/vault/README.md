# Workout Vault

这是个人训练资料库：Workout 计划、力量训练记录与 COROS 有氧数据在这里形成可阅读的本地投影。Workout 与 COROS 仍是事实源；vault 不是反向编辑或导入入口。

## 常用入口

| 路径 | 用途 |
| --- | --- |
| `plan/index.md` | 当前与后续训练周的紧凑索引 |
| `plan/weeks/YYYY-MM-DD.md` | 以周一命名的当前有效训练周 |
| `workout/index.md` | Workout Session 索引 |
| `daily/YYYY-MM-DD.md` | 某天的训练资料入口 |
| `routes/index.md` | 已确认路线与历史 |

日常看计划从 `plan/index.md` 进入，再点开需要的周。每个自然周只有一个稳定文件；计划更新时覆盖该文件，不累积 revision 副本。

## 更新方式

- `/workout plan2local`：从 live Workout 读取计划，更新索引、相关周文件和隐藏的同步证据。
- `/workout sync data [日期]`：同步训练记录与 COROS 有氧资料；不更新训练计划。

两条 route 都是显式写入操作。普通分析只读取本地文件，不会顺手刷新 vault。

## Plan 与 Session 为什么可能相似

- Plan 周文件表示“现在对每个日期最终计划做什么”，按自然周组织，不保存历史 revision。
- Session 文件表示“某一次实际执行基于什么处方、完成了什么”，是不可变、自包含的历史记录。

因此二者可能重复一部分处方内容，但不互相引用来省空间：否则计划变化或清理会破坏历史 Session 的可读性。管理上的去重发生在入口和生命周期，而不是把历史事实拆成脆弱的共享片段。

## 如何理解这些文件

- `data_as_of` 表示这份投影读取事实源的时间。
- `source_status` 表示来源读取状态；来源失败不能解释成“没有训练”。
- `training_version` 是 Workout 的训练数据状态序号，不是计划版本号。
- `plan_digest` 只用于判断两次本地计划投影的整体内容是否相同。
- `.sync/plan2local/effective.json` 是完整有效计划响应，`.sync/plan2local/manifest.json` 是生成文件清单和回执；两者主要供 Agent 与恢复使用。

同步器只清理由上一份 manifest 明确声明拥有的过期周文件，以及已知的旧版生成文件。个人笔记建议放在自建的 `notes/` 目录；未被 manifest 声明的未知文件不会被同步器清理。
