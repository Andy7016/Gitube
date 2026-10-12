# Gitube / RepoFlow

按 YouTube 的布局浏览 GitHub 开源项目：顶部搜索、分类标签、连续加载、多收藏夹、稍后再看、历史记录和真实 Star。默认前端采用 [Andy7016/Gitube](https://github.com/Andy7016/Gitube) 的界面与交互，接入本项目的浏览器 GitHub 认证、完整 README 和技术来源图谱。React + TypeScript + Vite，配套 Express 同源 API。

当前基于 2026-10-11 拉取的 Gitube 重建版 `418daee`，根 Git 仓库与本地分支 `integration/auth-graph` 只继承新上游历史。版本、版权与 MIT 许可证见 [gitube/UPSTREAM.md](gitube/UPSTREAM.md) 和 [LICENSE](LICENSE)。原前端 `src/` 保留，可通过 `npm run build:repoflow` 单独构建；默认 `npm run build` 构建 `gitube/`。集成理由见 [ADR 0006](docs/adr/0006-gitube-frontend-integration.md) 与 [重建版合并记录](docs/adr/0007-rebuilt-upstream-history.md)。[English](README.en.md)。

## 本地运行

需要 Node.js 22.12 或更新版本。

```powershell
npm install
npm run dev
```

打开 [本地页面](http://127.0.0.1:5173)。列表、统计、头像和 README 获取自 GitHub，没有演示数据。封面使用真实自定义社交预览图，或按仓库名称、语言、更新时间生成装饰图形；后者不是真实贡献热力图。未登录也可浏览公开项目；GitHub 限额或网络失败时页面显示实际错误，可点击重试。

GitHub 登录和数据请求由本机 Node 服务发出，运行它的进程需能访问 `github.com` 与 `api.github.com`。浏览器能打开页面还不能证明服务端可以联网；授权失败时界面会区分换凭证、读取账号和保存会话的失败阶段。

## GitHub 登录

直接点击页面右上角「GitHub 登录」。首次本机连接会跳转 GitHub，按其页面确认创建本站 GitHub App，然后继续授权登录。服务端自动保存连接信息，不需要创建或修改 `.env`；之后点击登录直接进入 GitHub 授权。

这里使用 [GitHub 官方 App manifest 注册流程](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)。首次注册是 GitHub 对应用身份的要求，由你在 GitHub 页面确认。应用只申请 Metadata 读与 Starring 写权限。凭据存放于被忽略的 `.local/github-app.json`，不发送给前端。访问令牌仅保存在服务端会话，浏览器使用 HttpOnly Cookie；授权使用 state / PKCE，写入校验 CSRF。

应用不使用 webhook，注册配置完全省略 webhook 地址。若之前看到 GitHub 的 `Hook url … 127.0.0.1` 错误，回到本站重新点击登录，勿继续提交旧错误页面的配置。

请保持使用 `http://127.0.0.1:5173`；应用回调地址绑定这个站点。如果已有 OAuth App 或正式部署，可由维护者使用 `.env.example` 提供现有应用凭据。此选项不是本地首次登录的前置步骤。

如果 GitHub App 登录后无法执行 Star，点击错误提示的「启用站内 Star」，或进入偏好设置的「站内 Star 连接设置」。本机网页向导会提供 GitHub OAuth App 注册入口与准确的站点 / 回调地址；注册后在网页填写 Client ID 和 Client secret，再完成 GitHub 授权，无需编辑本地文件。只有授权及身份校验成功后，服务端才将新连接保存到被忽略的 `.local/github-oauth.json`，原 App 连接保留。

OAuth 请求 `read:user public_repo`；GitHub 的 `public_repo` 同时包含公开仓库写权限，本站只用于公开项目读取与用户发起的 Star。请在 GitHub 授权页核对这一范围。连接机制与取舍见 [ADR 0013](docs/adr/0013-oauth-connection-for-public-stars.md)。

## 使用

- 搜索框按 Enter 或点击搜索按钮；支持普通关键词、`topic:react`、`language:rust`。
- 分类标签筛选兴趣，本周新星筛选近七天创建的仓库，本月热门筛选近三十天有代码更新的仓库。
- 点击封面或名称进入独立详情页，页面下方可阅读完整 README；可直接访问、刷新、分享地址，或使用浏览器前进后退回到项目流。
- 详情操作区提供稍后再看、收藏、Star、复制链接和打开原仓库；卡片右侧星标也可直接 Star / 取消 Star，未登录时提示跳转登录。
- 卡片三点菜单提供稍后再看、收藏、不感兴趣及 GitHub 原仓库入口。
- 底部自动加载下一页，也可点击手动加载；侧栏可折叠，手机使用抽屉导航。
- 登录后自动分析最近最多 1,000 个 Star 与最近更新的最多 300 个本人公开仓库，根据实际主题、主要语言与 Star 时间推荐项目；页面显示分析数量、采样范围与来自具体仓库的推荐依据。
- 默认推荐排除已 Star 和本人仓库。手选主题与语言仍可参与排序，自动分析不覆盖手选设置；主动搜索及明确分类保留指定范围。
- 首页与偏好设置可切换正常推荐、换换口味和完全随机。换口味默认约一半来自已关注方向，一半来自其他方向，候选不足时互补；完全随机在实际公开检索候选内抽取。探索模式照常记录浏览偏好，回到正常推荐时使用。
- 本次页面运行内分别保存各模式的推送列表与滚动进度，返回或切回模式会恢复原批次；主动换批才替换，继续滚动可加载后续内容。刷新页面视为再次启动。
- 偏好设置可分别调整已采样关注者的推荐权重（0–3 倍）；前台阅读仓库页超过 3 分钟，或超过 1 分钟并打开原仓库，会小幅增加相关标签权重，同账号同库 24 小时最多一次。[推荐控制设计](docs/adr/0010-recommendation-controls-and-reading-signals.md)。
- 账号画像缓存十五分钟，可点击「刷新兴趣」更新；一个来源失败时显示部分分析说明，全部失败仍可按已有偏好浏览。
- 打开项目后，技术来源图谱在独立框体自动处理一级，并显示圆形阶段进度。README 的 credits / citations、显式 GitHub 依赖和开发者关联项目均保留出处；直接引用在内档，人员关联在外档，各档按标签重合度、Star 确定远近。
- 可选中任一节点查看证据并手动继续追溯；侧栏「技术图谱」进入独立工作台，也可直接访问 `/graph/owner/repo`。采集有请求与时间上限，部分结果会说明原因；公开图谱缓存至本机，完整结果 24 小时、部分结果 5 分钟。
- 离开后返回图谱会恢复本次运行中保存的手动追溯、选中节点和视角；独立入口恢复最近工作台，主动搜索或重新分析才更新。离页中断的分析提供手动继续入口。[工作区恢复设计](docs/adr/0012-resumable-feed-and-graph-workspaces.md)。
- 节点面积表示真实 topic 重合度，至少 30% 标注名称；选择节点突出相连关系并居中，使用「查看全图」恢复概览。手动展开的分支分开放置，来源面板显示父路径与层级；语言回退不作为 topic 重合度。[呈现设计](docs/adr/0008-graph-branches-and-camera.md)。
- README 的 Related 与版权 / 许可证归属链接也参与发现；明确关系按“技术提供方 → 使用方”绘制箭头，普通提及、关联或冲突保持无向虚线。选中节点可核对原文、行地址和判定依据；仅有版权链接不代表依赖或许可证兼容。[技术流向设计](docs/adr/0009-readme-evidence-and-technical-flow.md)。
- 图谱工作区最多显示 120 个节点，手动最多延展 5 层；单任务最多 24 个直接来源、4 位相关人员各 100 个公开仓库，预算 40 次请求 / 90 秒。

热门程度不等于新的发现价值。关于已知高 Star 项目重复靠前的问题已列入 [推荐调研记录](docs/recommendation-research.md)；正常模式保留原有热门度公式，探索比例与阅读权重为可调整的初始策略，后续再评估熟悉度、长尾探索和重复曝光衰减。

收藏、稍后再看、历史、隐藏与偏好保存在当前浏览器，按访客及每个 GitHub 账号隔离，不跨设备同步。清除站点数据会移除这些本地记录。

## 构建与验证

```powershell
npm run check
npm start
```

先停止开发服务，再运行 `npm start`；它在同一个 `http://127.0.0.1:5173` 提供 `dist/` 与 API，已注册的回调地址可以继续使用。开发模式 Vite 将 `/api` 代理到 `127.0.0.1:5314`；本机 Windows 会拒绝绑定旧默认 3001，已使用可用端口。已有环境变量设置会优先于默认值；自行更改开发 API 的 `PORT` 时，也需同步 Vite proxy。

`npm test` 使用模拟 GitHub 与临时凭据，不操作真实账号。验收记录见 [docs/acceptance.md](docs/acceptance.md)。

## 正式部署

自动注册入口仅供本机开发使用。维护者为正式 HTTPS 网址注册 GitHub App，设置 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`GITHUB_APP_TYPE=github-app`、`APP_URL`、`NODE_ENV=production` 和至少 32 字符的随机 `SESSION_SECRET`；用户直接跳转 GitHub 授权。已有 OAuth App 也支持，省略 `GITHUB_APP_TYPE` 即使用 OAuth scopes。反向代理按实际拓扑设置 `TRUST_PROXY=1`。

服务仅监听 `127.0.0.1`，部署可通过 `PORT=3001` 指定代理目标端口。默认内存会话适合本地单实例，重启需要重新登录；多实例可通过 `createApp({sessionStore})` 接共享存储。当前未实现 OAuth refresh token 自动轮换，到期重新登录。

上游桌面封装源码保留在 `src-tauri/`，本轮尚未接入桌面安装包。当前版本需要 Node 同源 API，未启用上游静态 GitHub Pages / 桌面自动发布工作流。

[当前规格](docs/specification.md) · [接口](docs/api.md) · [账号推荐 ADR 0003](docs/adr/0003-account-signals-and-webhook-free-setup.md) · [详情与 README ADR 0004](docs/adr/0004-project-pages-and-full-readme.md) · [图谱规格](docs/graph-contract.md) · [图谱 ADR 0005](docs/adr/0005-technical-provenance-graph.md)
