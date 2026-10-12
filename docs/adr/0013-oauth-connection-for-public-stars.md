# ADR 0013：通过网页接入 OAuth App 执行公开 Star

日期：2026-10-11。状态：已采纳。补充 [ADR 0002](0002-youtube-feed-and-github-app.md) 与 [ADR 0011](0011-star-write-compatibility.md)。

## 来源与证据

用户确认网络恢复后可以登录，但真实 Star 仍返回 `STAR_PERMISSION_REQUIRED`。当前应用的公开元数据已核对为 `starring:write`、`metadata:read`，所以不能再把问题简单归为 manifest 未声明权限。REST 与同身份 GraphQL 兼容未解决当前账号拒绝；没有获取真人 Token 或原始错误正文，也不把所有 GitHub App 都描述成无法 Star。

GitHub App 用户身份只能在用户与应用的权限交集内操作；公开资源的隐式读权限并不代表公开写权限。OAuth App 的 `public_repo` 明确支持对公开仓库 Star。为该项目提供文档支持的另一种授权路径，并保留原 App 连接。

## 决定与理由

- 本机增加 `/api/setup/oauth` 网页向导。用户在 GitHub 注册 OAuth App，将 Client ID / Client secret 填入本机页面，再跳转 GitHub 授权；服务端保存连接，用户无须编辑配置文件。GitHub 注册和真实授权由用户本人完成。
- 凭据先只暂存在服务端会话，绑定一次性 state、PKCE 和十分钟期限。兑换确认公开 Star scope 并验证身份后才独占保存到新的 `.local/github-oauth.json`；失败可以重新填写。原 `.local/github-app.json` 保持不变，页面与响应不回填已保存 secret。
- 后续连接选择顺序为完整显式环境配置、新 OAuth 连接、原 GitHub App。网页不能覆盖维护者环境配置，也不能覆盖已保存 OAuth 连接；配置来源不匹配时显式失败。
- 只主动请求 `read:user public_repo`。`public_repo` 同时包含公开仓库写权限，这一范围在向导和 GitHub 授权页说明；本项目继续仅读取公开项目并执行用户发起的 Star，不申请 `repo` 私有仓库范围。
- 只有本机可以启用向导的 App 身份权限失败提供 `STAR_OAUTH_REQUIRED` 和“启用站内 Star”按钮。OAuth 身份的真正拒绝继续显示原状态与原仓库入口，不引导配置循环。成功标准仍是 GitHub 已确认写入。
- 设置向导只限本机开发连接，写入要求同源 CSRF；生产部署由维护者配置 OAuth App。Token、客户端 secret 与候选连接均不进入前端存储或日志，诊断继续固定阶段 / 分类白名单。

## 验收与边界

验证候选配置不提前持久化、失效 / 重放 state、取消与 scope 不足、身份失败、保存失败、成功轮换会话、后续 OAuth 连接及环境优先级。浏览器验证向导、权限按钮、表单、授权跳转、成功 Star / 取消、失败保留状态和手机布局。模拟通过不等于真人 OAuth 或真实 Star 已成功，结果见 [验收记录](../acceptance.md)。

2026-10-11 用户完成新连接后明确确认“Star 和取消 Star 都成功”，当前账号的真实写入验收通过；保留此前 App 权限拒绝作为方案演进依据，不将该结果外推至所有账号或部署环境。

此方案需要一次 GitHub OAuth App 注册；GitHub App manifest 不会自动创建 OAuth App。默认内存会话重启仍需登录，未增加 refresh token 自动轮换。

官方依据：[GitHub App 授权与安装](https://docs.github.com/en/apps/using-github-apps/authorizing-github-apps)、[OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)、[注册 OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)。
