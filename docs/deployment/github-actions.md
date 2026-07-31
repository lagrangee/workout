# GitHub Actions 与 Cloudflare 部署

仓库 `lagrangee/workout` 只保留 PR 校验 workflow：

- `.github/workflows/ci.yml`：Pull Request 只运行 `npm run release-check`，不部署生产环境。
- 生产部署不再由 GitHub Actions 触发，使用 [手动 Wrangler 部署说明](./wrangler-manual-deploy.md)。

PR 校验不需要 Cloudflare 部署 Secret；生产发布由本机 Wrangler 身份执行。

应用身份不通过 GitHub Actions Secret 注入。生产 Cloudflare Worker 还需要在 Cloudflare 端配置以下 Worker Secrets：`ATHLETE_A_EMAIL`、`ATHLETE_B_EMAIL`、`AUTH_A_PASSWORD`、`AUTH_B_PASSWORD`、`AUTH_SESSION_SECRET`。密码和签名 Secret 只能通过 `wrangler secret put` 的交互输入设置，不能出现在命令参数、仓库或日志中。

生产部署不再由 GitHub Actions 触发，也不需要配置 GitHub 的生产 Environment、部署保护规则或部署并发组。发布前在本机完成 release check，再由有权限的操作员执行 Wrangler 部署。生产域名固定为 `https://workout.lagrangee.xyz`，`workers.dev` 和 Preview URL 仍由 `wrangler.toml` 的生产配置关闭。

本地 `npm run release-check` 验证代码、配置和恢复材料；它不替代手动 Wrangler 的线上 route、Secret、D1 和 seed read-back 检查。

`CLOUDFLARE_API_TOKEN` 不再是 GitHub Actions 的生产发布依赖。若本机使用 API token 登录 Wrangler，请把它保存在本机受保护的环境或 Wrangler 登录状态中；不要写入仓库或 Cloudflare Worker Secret。应用登录所需的 Worker Secrets 仍只通过 `wrangler secret put` 配置。
