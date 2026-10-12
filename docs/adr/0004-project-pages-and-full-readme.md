# ADR 0004：独立项目详情页与完整 README

日期：2026-10-10。状态：已采纳。补充 [ADR 0002](0002-youtube-feed-and-github-app.md)，账号推荐与登录延续 [ADR 0003](0003-account-signals-and-webhook-free-setup.md)。

## 来源与问题

用户反馈：点击推荐后出现悬浮组件，仅展示封面、标题、描述和标签，无法利用下面的页面空间阅读完整 README；原仓库入口是文字链接，不符合视频详情页的操作习惯。用户要求按 YouTube 的列表到详情页逻辑交互，并将操作改为稍后再看、Star、复制链接和打开原仓库。

参考 YouTube 官方的 [保存到播放列表](https://support.google.com/youtube/answer/57792?hl=en&co=GENIE.Platform%3DDesktop) 与 [稍后观看](https://support.google.com/youtube/answer/56101?hl=en&co=GENIE.Platform%3DDesktop) 文档：观看页面是保存操作的上下文，浏览时也可从内容入口加入稍后观看。本项目采用列表与详情页面共享本地记录的交互，不引入视频播放器或额外宣传区域。

## 决定

- 用 `/project/:owner/:repo` 取代详情弹窗。列表封面和标题使用真实站内链接，支持浏览器新标签页、直接访问、刷新、前进与后退；回列表保留筛选和浏览位置。
- 列表筛选、已加载分页与位置保存到当前浏览历史条目，只在账号 scope 匹配时恢复，不保存账号画像。返回异步详情时，在正文 DOM 提交后恢复位置；加载过渡期间暂停滚动记录与浏览器锚定，防止过早恢复被骨架高度截断或覆盖。
- 详情页上方展示实际项目封面、资料和按钮操作，下方使用页面自然滚动展示完整 README。登录与偏好设置仍使用原有对话框。
- 稍后再看、收藏复用当前账号的本地记录；Star 复用真实 GitHub API 和 CSRF 校验，成功后更新。复制链接分享站内详情 URL，原仓库入口为有 GitHub / 外部跳转图标的显著按钮。
- 新增同源 `GET /api/repos/:owner/:repo`。仅访问固定 GitHub API 端点获取公开仓库资料和其首选 README，UTF-8 完整解码；无 README、暂时失败和仓库不存在分别表示。超过 2 MiB 或无法完整解码时明确提示，不截断后声称完整。
- GitHub App 权限保持 Metadata read / Starring write。已确认公开仓库后，若 README 因权限不足返回 403，使用匿名公开 API 重试；401 与限流不走此回退，不读取私有源码。依据 [GitHub README API](https://docs.github.com/en/rest/repos/contents#get-a-repository-readme) 的公开资源访问规则。
- Markdown 使用 [react-markdown](https://github.com/remarkjs/react-markdown)、GFM 与经过清洗的 HTML 渲染，支持表格、代码、图片、目录和折叠内容。禁止可执行脚本、事件、iframe 和危险链接；仓库文档作为不可信内容，不作为应用指令。相对资源根据 README 的实际路径解析；单斜杠开头的路径按仓库根目录解析，遵循 [GitHub 相对链接规则](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#relative-links)。
- 完整详情按仓库及 Token 摘要缓存五分钟、最多 128 条并合并在途请求；部分失败不缓存。当前账号 Star 状态在公共内容外单独补充，响应不包含凭据且禁止浏览器缓存。

## 取舍与验收

独立详情页增加路由及 README 渲染成本，但获得可分享地址、浏览器导航与充分阅读空间。完整 Markdown 渲染放在详情相关模块，首页继续直接浏览项目流。文档没有评论区、订阅或假数据。

接口与服务测试覆盖完整解码、错误分离、权限回退、账号状态、会话过期、缓存与固定端点；浏览器验证列表到详情、历史导航、直接访问、按钮动作、真实 README、HTML 清洗与移动端溢出。最终结果记录在 [验收](../acceptance.md)。
