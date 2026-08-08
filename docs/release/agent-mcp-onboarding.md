# Workout Agent MCP onboarding

这条路径把连接配置留在本机用户目录，不把凭证写进仓库、Codex 对话或
MCP 启动参数。Skill 只负责路由和确认边界；本文件负责本机接入。

## 1. 准备用户配置文件

先确认生产前置条件已经完成：当前 Worker 已部署，`0005_agent_token_lookup.sql`
已应用，`AGENT_TOKEN_SECRET` 已通过 Cloudflare Secret 配置，并且你已在已认证
的 Workout App 中创建或轮换个人 Agent Token。Token 只在创建/轮换响应中显示一次。

在本机执行：

```bash
mkdir -p "$HOME/.config/workout-agent"
umask 077
touch "$HOME/.config/workout-agent/agent.env"
chmod 600 "$HOME/.config/workout-agent/agent.env"
"${EDITOR:-vi}" "$HOME/.config/workout-agent/agent.env"
```

文件只包含下面两行；把占位符替换为你在本机收到的值，不要把值粘贴到
Codex 对话：

```text
WORKOUT_AGENT_API_ORIGIN=https://workout.lagrangee.xyz
WORKOUT_AGENT_TOKEN=<token-created-in-the-authenticated-app>
```

`mcp/launch.mjs` 只接受 owner-only 文件、这两个键和非空值；缺少文件、权限
过宽、重复键或缺少键会在启动时给出不含凭证值的错误。

## 2. 注册本地 MCP

从仓库根目录把本地启动器注册给 Codex。命令只写配置文件路径，不写 Token：

```bash
codex mcp add workout \
  --env WORKOUT_AGENT_CONFIG_FILE="$HOME/.config/workout-agent/agent.env" \
  -- node "$PWD/mcp/launch.mjs"
```

用 `codex mcp get workout` 检查命令和配置文件路径，用 `codex mcp list` 检查
状态；配置变化后启动一个新的 Codex task/process，MCP 不会在当前进程中热加载。

## 3. 凭证生命周期

- 配置文件缺失或键缺失：补齐本机文件，错误输出不会显示值。
- Token 轮换：在 App 中轮换后只更新本机 `WORKOUT_AGENT_TOKEN`，保持文件为
  `600`，然后启动新的 Codex task/process。
- Token 撤销：撤销后保留本机文件也只能得到稳定的 `agent_unauthorized`；清理
  或替换本机文件，再重新完成授权流程。
- 任何 `401`、`503` 或传输错误都按配置/服务边界处理，不在对话中索取或回显
  Token。

## 4. 本机 smoke 边界

成功注册后，先用只读工具验证 `workout_get_overview`、`workout_get_plan`、显式
日期范围的 `workout_get_schedule`、Session/Progress/Exercise history 读取，
再验证 `workout_validate_plan_update` 的非变更 preview。真实计划 application
必须展示完整 preview，并等待一次独立、明确的 Athlete confirmation；确认前不
调用 apply，成功后检查 Plan 与七天 Schedule readback。

自动化测试、MCP 单元 smoke、部署 smoke 和 human acceptance 分开记录；这些
步骤本身不等于 Gate Passage。
