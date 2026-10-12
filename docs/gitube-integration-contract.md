# Gitube 集成接口

2026-10-11 补充：Star 的固定同身份 GraphQL 兼容路径见 [ADR 0011](adr/0011-star-write-compatibility.md)，API 路径与 CSRF 合同保持；运行内推送与图谱工作区恢复见 [ADR 0012](adr/0012-resumable-feed-and-graph-workspaces.md)。模式切换恢复已有批次，主动换批才替换，页面刷新视为新启动。

来源：用户 2026-10-10 授权合并 Andy7016/Gitube 的前端与现有认证、追溯；2026-10-11 要求改用重建后的仓库。上游 main 固定版本 `418daee527607dd0a97b1c8d675bf0a7a4895ecf`，MIT；来源更新见 [ADR 0007](adr/0007-rebuilt-upstream-history.md)。前端位于 `gitube/`，原 `src/` 保留可构建，后端共用 `server/`。本文件规定此次前后端交界。

## 会话与操作

- `GET /api/session` 沿用 `{user,csrfToken,oauthConfigured}`；user 的 `login/name/avatar_url/html_url` 映射到 Gitube Viewer，缺少 GraphQL id 时以 login 作本地标识，不能拿它调用 GitHub mutation。
- 浏览器以 `/api/auth/github` 登录。Token 只在服务端，不进入浏览器存储、响应或 URL。登出复用 `POST /api/logout`。启动会话恢复、401 与账号切换必须清理并阻止旧账号请求回写。
- 新增 `POST /api/gitube`，CSRF 必需，返回 `{data,meta?}`。服务端只接受下面列出的具名操作，不能接受任意 GraphQL、API 路径、Token 或上游主机。错误沿用现有 `{error,code}`。
- `meta` 可包含真实 `rateRemaining/rateLimit/rateReset`，无信息则 null，不虚构额度或权限。

## 具名操作

Gitube Repo/SearchPage/FollowingStar 采用 `gitube/src/api/types.ts` 的形状。所有仓库均限制为公开；缺少的可选元数据用 null，不生成假封面、假发布时间或假用户。REST Star 列表没有准确公开总数，`myStars.total` 为 null；仓库 watchers / openIssues 缺失也为 null。Repo.id 优先使用真实 node_id，缺失时 `repo:owner/name` 仅作本地稳定标识，不能用于 GitHub mutation。

| operation | 额外输入 | data |
| --- | --- | --- |
| searchMany | `specs:[{query,after:string|null,first:number}]`，最多 8 个，单项最多 100，query 最长 300 | `SearchPage[]`，顺序与 specs 相同 |
| repository | `owner,name` | `RepoDetail` |
| seeds | 无；需登录 | `{starred:Repo[],own:{language:string|null,topics:string[]}[],profile?:RecommendationProfile}` |
| myStars | `after:string|null`；需登录 | `SearchPage` |
| followingStars | 无；需登录 | `FollowingStar[]` |

底层允许固定 GraphQL 或 REST，分页游标是不透明、受校验的字符串，不允许注入查询。匿名浏览搜索/详情必须可用。画像 profile 复用现有最多 1000 个 Star / 300 个本人公开仓库的服务，数量、截断与警告必须可见，不缩减成仅最近 Star。

Star 复用 `PUT/DELETE /api/starred/:owner/:repo`；Gitube `setStarred(repoId)` 可在前端 repoCache 解析实际 owner/name 后调用，成功后返回本地推算计数时要基于原状态且不得伪称服务器返回计数。README 复用 `GET /api/repos/:owner/:repo` 的原文与安全 renderer。

现有 GitHub App 未请求 Followers write，关注写入本次不扩权。三连调整为真实成功的 Star、收藏与稍后再看，不显示已关注作者；可保留指向作者页面的按钮。公开关注动态读取失败必须显式解释，不能用伪数据补齐。

## 路由与图谱

BrowserRouter 保留 Gitube `/repo/:owner/:name`、收藏、历史、搜索、设置和引导；兼容旧 `/project/:owner/:repo`，增加 `/graph`、`/graph/:owner/:repo`。复用 `src/TechnologyGraph.tsx`，桥接 account、csrfToken、导航和会话失效回调。图谱 CSS 适配 Gitube 深浅主题；嵌入框体独立滚动，README 完整展示。

保留上游已有的频道、反馈、多收藏夹、主题、快捷键与浏览器返回体验。登录页去除装饰 fixture，不要求 PAT 或修改本地配置。推荐热门度的新机制仅记入 [调研记录](recommendation-research.md)，本次不先行实验。

2026-10-11 补充推荐控制见 [ADR 0010](adr/0010-recommendation-controls-and-reading-signals.md)：前端复用既有 `followingStars` 与 `searchMany`，不增加 API 操作、授权范围或账号数据上限；`LibraryData.version:1` 兼容新增模式、关注者权重和阅读去重字段。阅读与模式行为仅在当前账号的浏览器本地记录。正常模式可受关注者与阅读权重影响，两个探索模式仍记录偏好但不采用兴趣排序；这不替代尚待调研的热门项目熟悉度降权。
