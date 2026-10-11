# ADR 0002：YouTube 式真实项目流与网页 GitHub 接入

日期：2026-10-09。状态：接受；注册 webhook 与账号兴趣规则由 [ADR 0003](0003-account-signals-and-webhook-free-setup.md) 补充修正。更新 [ADR 0001](0001-github-auth-and-recommendations.md) 的数据与登录选择，保留服务端会话和主题检索架构。

## 来源与目标

用户补充截图并要求按 YouTube 的布局和交互浏览项目，删除宣传语及所有演示数据，全部实际获取；登录应跳转 GitHub 认证，不要求手动修改本地文件。验收范围见 [规格](../specification.md)。

## 决策与理由

采用顶部搜索、可折叠侧栏、横向分类标签、16:9 仓库封面与连续加载的项目网格。保留本地收藏，增加稍后再看和浏览历史；Star 仍写入真实 GitHub 账号。删除演示数据及演示 Star 分支。无数据、限额和网络失败显示实际状态与重试入口。

项目列表来自 GitHub REST API，封面来自仓库的 GitHub Open Graph 地址，头像来自 GitHub。兴趣查询仍逐主题检索、交错去重；相同公共检索共享五分钟缓存，并合并进行中的相同查询，减少开发模式重复请求和匿名限额消耗。真实数据缓存不等于实时流式抓取。

GitHub 不允许未注册应用直接完成 OAuth。首次本机登录采用官方 GitHub App manifest 流程：服务端生成最小权限 manifest，浏览器 POST 到 GitHub；用户在 GitHub 确认创建应用后，服务端兑换一次性 code，自动保存 client ID / secret，再跳转授权登录。仅申请 Metadata 读与用户 Starring 写权限，GitHub App 授权不携带 OAuth App 的宽泛 scope。

连接信息仅保存到被忽略的 `.local/github-app.json`，不保存返回的私钥或 webhook secret。文件采用独占创建，不能通过后续接入覆盖。注册 state 与浏览器会话绑定、十分钟有效、单次消费；自动接入只允许开发环境、本机连接与本机 hostname。正式部署由站点维护者提供应用连接，普通用户只做授权登录。已有 OAuth App 环境变量仍可兼容。

收藏、稍后再看、历史、隐藏和兴趣以访客及 `github:<login>` 隔离，不从旧演示空间迁移数据。保持 Token 在服务端、HttpOnly Cookie、OAuth state / PKCE、CSRF 和写入成功后更新 UI 的约束。

## 取舍与边界

- 本机第一次仍需在 GitHub 确认注册应用，这是 GitHub 的应用身份要求；自动保存免去了编辑 `.env`。
- GitHub App 绑定站点 origin；开发和生产需使用对应的回调地址。
- GitHub 搜索及封面可能限额或不可用；页面显示错误或封面不可用状态，不补充虚构项目。
- 收藏等仍保存在当前浏览器，不跨设备同步；默认内存会话重启后需重新登录。

## 依据与验收

- [GitHub App manifest 注册流程](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
- [Manifest code 兑换 API](https://docs.github.com/en/rest/apps/apps#create-a-github-app-from-a-manifest)
- [GitHub App 权限](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [验收记录](../acceptance.md)
