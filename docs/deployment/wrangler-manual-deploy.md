# 手动 Wrangler 生产部署

生产环境不使用 GitHub Actions auto deploy。发布前在仓库根目录执行：

```bash
npm run release-check
npx wrangler deploy
```

部署完成后，用不携带身份信息的请求确认 custom domain：

```bash
curl --fail --silent --show-error https://workout.lagrangee.xyz/healthz
```

生产 Worker 的应用身份 Secret 不写入仓库；邮箱、密码和 `AUTH_SESSION_SECRET` 通过 `wrangler secret put` 单独配置。GitHub 仓库仍可保留 PR 校验 workflow，但 GitHub Actions 不再拥有生产部署职责，也不再是 release gate。
