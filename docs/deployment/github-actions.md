# GitHub Actions 与 Cloudflare 部署

仓库 `lagrangee/workout` 使用两个 workflow：

- `.github/workflows/ci.yml`：Pull Request 只运行 `npm run release-check`，不部署生产环境。
- `.github/workflows/deploy.yml`：`main` 分支 push（或从 `main` 手动触发）先运行同一套检查，再通过 `cloudflare/wrangler-action@v3` 部署 `wrangler.toml`。
  部署后以不携带身份信息的 `GET https://workout.lagrangee.xyz/healthz` 验证 custom hostname；workflow 会把该检查写入 Step Summary。

仓库需要以下 GitHub Actions Secret：

- `CLOUDFLARE_ACCOUNT_ID` — 已配置为当前 Cloudflare Workers 账号。
- `CLOUDFLARE_API_TOKEN` — 需要在 GitHub 仓库设置中补充一个专用于该 Worker 的 Cloudflare API Token。不要提交到文件、命令历史或聊天记录。

应用身份不通过 GitHub Actions Secret 注入。生产 Cloudflare Worker 还需要在 Cloudflare 端配置以下 Worker Secrets：`ATHLETE_A_EMAIL`、`ATHLETE_B_EMAIL`、`AUTH_A_PASSWORD`、`AUTH_B_PASSWORD`、`AUTH_SESSION_SECRET`。密码和签名 Secret 只能通过 `wrangler secret put` 的交互输入设置，不能出现在命令参数、仓库或日志中。

建议在 GitHub 的 `production` Environment 中配置部署保护规则；workflow 已使用固定的 `production-deploy` 并发组，避免两个生产部署同时进行。生产域名固定为 `https://workout.lagrangee.xyz`，`workers.dev` 和 Preview URL 仍由 `wrangler.toml` 的生产配置关闭。

本地 `npm run release-check` 只验证 workflow/config 结构，不代表 GitHub repository visibility、Actions run、secret availability 或 production route 已通过。创建 `lagrangee/workout`、补 secrets、push 和 deploy 需要单独的 release execution 授权。

首次补充 token 可在本机执行（命令会安全提示输入，不要把值写进 shell 参数）：

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo lagrangee/workout
```

补充 token 前，先在 Cloudflare 创建最小权限的 API Token，并确认 D1、Worker、Routes 等权限覆盖当前部署所需资源。
