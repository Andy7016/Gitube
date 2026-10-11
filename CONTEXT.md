# RepoFlow 领域约定

来源：2026-10-09 用户创建请求与截图反馈。当前要求与验收见 [规格](docs/specification.md)。

- 项目：GitHub 公开、未归档、非 fork 的仓库；推荐检索筛选超过 20 Star 的项目。
- 项目流：YouTube 式网格及连续加载，仅使用实际 GitHub 数据，无演示模式。公共检索缓存五分钟。
- 详情：独立 `/project/:owner/:repo` 页面，完整、安全渲染实际 README，按钮操作与项目流共享账号状态，支持浏览器导航及站内地址分享。
- 推荐：手选偏好与账号历史 Star / 本人公开仓库的主题、语言共同决定检索与排序，属于可解释的规则推荐。
- 技术图谱：独立于推荐画像，详情自动一级解析公开引用与开发者关联项目；直接引用内档、关联项目外档，档内按 topics 重合度、Star 排序。继续追溯由单节点手动启动，所有关系保留证据。独立入口 `/graph`，范围见 [图谱规格](docs/graph-contract.md) 与 [ADR 0005](docs/adr/0005-technical-provenance-graph.md)。
- 收藏 / 稍后再看 / 历史：浏览器本地记录，按访客与 GitHub login 隔离。
- Star：GitHub 账号真实 Star，成功后更新界面。
- 兴趣：手选主题与语言；登录后自动分析最多 1,000 个 Star 与 300 个本人公开仓库，显示实际数量与截断状态，不覆盖手选设置。
- 登录：浏览器跳转 GitHub；首次本机通过 manifest 自动注册连接，服务端自动保存凭据。

2026-10-10 采用 Andy7016/Gitube 的前端作为默认入口，权威实现为 `gitube/src/` 与 `server/`；根 `src/` 保留为原前端，可运行 `npm run build:repoflow`。合并范围与取舍见 [ADR 0006](docs/adr/0006-gitube-frontend-integration.md) 和 [集成接口](docs/gitube-integration-contract.md)。界面保留原有频道、反馈、多收藏夹、主题；完整 README、会话和图谱复用本项目后端。推荐热门度与发现价值的后续研究见 [调研记录](docs/recommendation-research.md)，本次不先行改动算法。

参见 [API](docs/api.md)、[ADR 0003](docs/adr/0003-account-signals-and-webhook-free-setup.md)、[验收](docs/acceptance.md)。历史方案保留在 ADR 0001 / 0002。

2026-10-11 改用 Gitube 重建版 `418daee527607dd0a97b1c8d675bf0a7a4895ecf` 作为根 Git 历史基线，本地集成分支 `integration/auth-graph`；业务代码与上次参考上游一致，保留已完成的 Web 集成。来源和隐私处理见 [ADR 0007](docs/adr/0007-rebuilt-upstream-history.md)。

图谱的多层呈现采用独立分支与摄像机聚焦，节点面积表达真实 topic 重合度，至少 30% 时标注名称；语言回退不显示为 topic 百分比。补充决定见 [ADR 0008](docs/adr/0008-graph-branches-and-camera.md)，采集范围与显示上限保持不变。

README 的 Related、版权 / 许可证归属链接也参与一级发现；技术箭头依据明确局部文档证据从提供方指向使用方，未知或冲突关系无向。采集路径、结构层级与技术流向分别记录，新语义缓存版本为 2。规则、边界与取舍见 [ADR 0009](docs/adr/0009-readme-evidence-and-technical-flow.md)。
