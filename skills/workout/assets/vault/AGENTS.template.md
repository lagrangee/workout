# Workout Vault Agent Guide

这个 vault 是 Workout 与 COROS 的本地只读投影。回答问题时先确定语义 owner，再选择最小证据面。

## 读取顺序

1. 当前或未来训练计划：先读 `plan/index.md`，再读链接到的目标 `plan/weeks/YYYY-MM-DD.md`。只有需要完整无损字段或恢复时才读 `.sync/plan2local/effective.json`。
2. 历史训练：先读目标日期的 `daily/YYYY-MM-DD.md`，再沿链接读取 Workout Session、COROS activity 或 route note。
3. 每次使用本地记录都检查 `schema_version`、`source_status` 与 `data_as_of`。今天、缺失、partial、error 或用户要求刷新时，回到 live Workout/COROS。

Workout 拥有计划、Scheduled Workout、Session 与力量训练事实；COROS 拥有有氧 telemetry。相同 local date 只提供上下文，不构成跨来源的同一事件关系。本地文件与 live 来源冲突时以 live 来源为准。

## Plan 与 Session 的边界

`plan/weeks/` 描述每个日期当前最终生效的处方，不保存 Plan Revision 历史；Session 描述一次实际执行及其处方快照。两者即使内容相似也不等价：Plan 不是完成证据，Session 也不是未来计划。不要为了文本去重而把 Session 改成对 Plan 周文件的引用；历史 Session 必须保持不可变、自包含，并在 Plan 文件被覆盖后仍可独立解释。

## 写入与所有权边界

- `/workout plan2local` 管理 `plan/index.md`、manifest 列出的 `plan/weeks/YYYY-MM-DD.md`、`.sync/plan2local/effective.json` 与 `.sync/plan2local/manifest.json`。
- `/workout sync data [日期]` 更新训练历史归档及其回执。
- 计划变更使用 Workout 的 read–validate–confirm–apply–readback 流程；vault 内容不作为写回输入。

清理旧计划时，只可删除前一份 `.sync/plan2local/manifest.json` 声明且符合生成命名规则的过期周文件，以及契约列出的旧版生成路径。保留未知文件和用户笔记。`plan/index.md` 是最小默认读取面；不要为了回答当前周问题加载所有未来周或完整 `effective.json`。

把 `daily/`、`weekly/`、`workout/`、`routes/`、`data/` 与 `.sync/` 中现有历史文件视为生成或证据文件。用户笔记优先放在 `notes/`。不要把缺失值改写成零，不要从本地投影伪造 live success，也不要在 vault 中保存凭据。

`training_version` 是源端训练数据状态序号，不是计划版本号。用 `.sync/plan2local/manifest.json` 的 `plan_digest` 判断整体有效计划是否变化，用各周文件的 `week_digest` 识别周内容，用 `data_as_of` 判断新鲜度。
