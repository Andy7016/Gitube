# ADR 0011：Star 写入兼容与真实失败状态

日期：2026-10-11。状态：已采纳。补充 [ADR 0002](0002-youtube-feed-and-github-app.md) 与 [ADR 0006](0006-gitube-frontend-integration.md)。

后续证据：用户确认网络恢复后登录成功，但本方案的同身份兼容仍未解决真实 Star 拒绝；公开 App 元数据中的 Starring 写与 Metadata 读声明正确。因此本方案保留为接口兼容，不能作为当前账号问题已修复的证据。另增独立 OAuth App 网页接入，见 [ADR 0013](0013-oauth-connection-for-public-stars.md)。

## 来源与判断

用户在登录成功后对多个仓库点击 Star，均看到通用“GitHub 未授权此操作，请检查 OAuth 权限后重新登录”。现有代码将非限流的上游 403 统一转成此提示，不能据此判断具体是应用权限、仓库访问范围还是其他 GitHub 拒绝；本轮没有获取真人 Token 或原始失败响应。

GitHub REST Star 接口要求 Starring 写与 Metadata 读权限，GitHub App 对仓库的访问范围又受到安装限制。本站 manifest 已申请这两项权限；仅反复登录并不能保证解决接口访问差异。保留既有凭据与最小权限，通过同一用户身份的固定 GraphQL 操作提供有界兼容。

## 决定

- 本站 PUT / DELETE API、登录校验、同源 CSRF 与成功后的画像失效保持原合同。REST 写入显式使用空正文，只在确认成功后更新缓存。
- 仅 REST 返回已分类的非限流权限 403 时，执行一次固定 GraphQL 仓库查询，并在必要时调用 `addStar` / `removeStar`。不将 401、限流、网络失败或不确定的写入结果当作切换接口后重复写入的依据。
- 查询严格核对公开 Repository、仓库全名、Node ID 和实际 Star 状态；mutation 也校验对应目标与实际结果。只接受服务端固定查询和参数，不接收浏览器传入的任意 GraphQL、上游地址或 Token。
- 真正的权限拒绝返回专用 `STAR_PERMISSION_REQUIRED`，前端保持原状态，并提供“在 GitHub 打开”入口。失败不伪装成成功，不自动匿名写入、不申请更大的权限，也不改写既有 App 配置。

## 验证与限制

使用隔离 GitHub 响应验证 REST 成功、同身份兼容、幂等、拒绝、限流、会话过期、格式错误及缓存提交边界。真人 OAuth 与真实 Star 写入由用户本人验证；模拟通过不能证明当前账号获授权限。GraphQL 也会执行 GitHub 权限校验，不能保证解决所有 403；没有标准限流头的未知拒绝仍可能进入一次兼容查询。

官方依据：[REST Starring](https://docs.github.com/en/rest/activity/starring#star-a-repository-for-the-authenticated-user)、[GraphQL Activity](https://docs.github.com/en/graphql/reference/activity#addstar)、[GitHub App 与 OAuth App 的访问范围](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps)。实际验收追加于 [验收记录](../acceptance.md)。
