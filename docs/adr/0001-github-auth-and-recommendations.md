# ADR 0001：GitHub OAuth 服务端会话和主题推荐

日期：2026-10-09。状态：部分被 [ADR 0002](0002-youtube-feed-and-github-app.md) 取代。下文保留最初实现的决策记录；当前数据来源、登录和缓存规则以 ADR 0002 为准。

## 背景

用户需要内容平台式的开源项目发现体验，以及 GitHub 登录和 Star。工作目录为空，未配置远程仓库与 OAuth App。浏览器不能安全保管 OAuth client secret，因此单纯静态前端不足以完成授权码交换。

## 决策

使用 React / TypeScript / Vite 构建前端，Express 提供同源 OAuth 与 GitHub API 代理。Token 只保存在服务端会话；浏览器使用 HttpOnly、SameSite=Lax Cookie。授权带随机 state 与 S256 PKCE，成功后轮换 session ID；Star、注销使用 CSRF Token，另校验存在的 Origin。

OAuth App 申请 `read:user public_repo`；GitHub 当前 OAuth scope 要求 `public_repo` 才能 Star 公开仓库。范围比单纯 Star 更广，因此正式产品可迁移到细粒度 GitHub App。采用 OAuth App 是为了第一版本地配置简单、容易运行，并保持前端同一套接口。

推荐采用主题分别检索、交错和去重。2026-10-09 实测 GitHub repository search：`(topic:artificial-intelligence OR topic:web-development)` 返回 200 但 0 项，无括号 OR 返回 422，单主题返回 200 和正常结果，因此不能依赖 OR 表达式。每个兴趣独立查 ceil(12/兴趣数) 条，最多五兴趣，客户端跨页继续去重。搜索最多 83 页，公共检索缓存 60 秒、最多 128 组；登录后按项目校验真实 Star 并短暂缓存。

未配置 OAuth 默认演示模式，允许切真实公共项目。演示、访客和每个账号分别存储收藏和兴趣。演示 Star 永不在登录时自动提交 GitHub。真实 API 出错时界面显示错误和重试入口，用户手动选择演示。

## 取舍

- 与纯静态页面相比，多一个小型 Node 服务，但密钥不进入客户端。
- 与模型推荐相比，主题规则更容易解释和独立运行；长期兴趣学习、跨设备收藏、后台通知不在第一版范围。
- 与生产数据库会话相比，内存会话不需要基础设施，但重启注销且不适合多实例；保留 `sessionStore` 注入接口。
- 单个主题独立请求会更快耗尽匿名 search 限额；60 秒缓存缓解重复请求，界面明确显示限额错误。

## 依据

- [GitHub OAuth web flow 和 PKCE](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
- [Star API](https://docs.github.com/en/rest/activity/starring)
- [Express session store](https://expressjs.com/en/resources/middleware/session/)

验收证据见 [acceptance.md](../acceptance.md)。
