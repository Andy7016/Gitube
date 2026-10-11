# ADR 0005：可追溯的技术来源图谱

日期：2026-10-10。状态：已采纳。补充 [ADR 0004](0004-project-pages-and-full-readme.md)，与推荐画像独立。详细接口与采集边界见 [图谱规格](../graph-contract.md)。

## 来源与目标

用户要求打开项目后自动追溯一级，独立框体展示引用树与技术路线；README 中的 credits / citations 优先作为来源，主要开发者与维护者的相似项目也可加入。直接引用为内档，人员关联为外档；档内按标签重合度、Star 排序，手动选择节点才能继续追溯。

## 决定与理由

- 后端提供有会话归属的异步 Job，前端按阶段显示圆形进度并有界轮询。详情页自动启动，另有 `/graph` 工作台与可分享的 `/graph/:owner/:repo`。自动采集不递归；手动扩展再次启动选中仓库的一级任务，合并节点与证据并防环。
- 解析 Markdown 结构、引用链接与 HTML 链接，优先识别 credits、acknowledgements、citation、references 等段落。只解析可信 GitHub 仓库地址，再通过公开仓库元数据确认。根目录常见依赖清单中的显式 GitHub 地址也可提供依赖证据；不执行源码、安装依赖或根据包名猜仓库。
- 使用主要贡献者、CODEOWNERS 中明确列出的个人、README 的维护者信息及个人所有者作为人员来源，保留角色与出处。GitHub 的 [contributors API](https://docs.github.com/en/rest/repos/repos#list-repository-contributors) 按贡献数返回，资料可能缓存数小时；贡献者身份不直接等于维护者。[CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) 按 `.github/`、根目录、`docs/` 的优先顺序选择文件。团队与邮箱不猜测为个人，也不扩展私有成员资料。
- 每人仅扫描最近更新的公开自有仓库，排除 fork、归档和根项目；相似度采用 GitHub topics 集合的 Jaccard 重合度。根项目没有 topics 时，主要语言相同仅作为标明的回退依据。每档按重合度降序、Star 降序、仓库名稳定排序，SVG 径向布局据此确定远近，不引入随机力导向抖动。
- 默认最多解析 24 个引用、扩展 4 人、每人 100 个公开仓库；每任务最多 40 次 GitHub 请求、90 秒。全局两项并行、排队最多 16 项、每会话三项在途。请求预算、超时、限流、缺失来源等形成显式部分结果，不用虚构数据补齐。
- 完整公开结果缓存 24 小时，部分结果缓存 5 分钟，最多 64 项，原子写入 `.local/graph-cache.json`；任务是短期内存状态，绑定创建会话。缓存只保留公开结果白名单字段，不存令牌、账号 Star 状态或原始源码。强制刷新有 30 秒冷却。
- 继续使用 Metadata read / Starring write 的既有权限；已确认公开的源码端点如遇普通权限 403，可匿名读取，401 与限流不能绕过。GitHub 认证失效沿现有清会话路径处理。
- 不使用即将关闭的同步 SBOM 导出作为主要方案。[GitHub 官方 SBOM 文档](https://docs.github.com/en/rest/dependency-graph/sboms#export-a-software-bill-of-materials-sbom-for-a-repository) 已注明同步端点将于 2026-11-13 关闭。直接基于公开 README、明确仓库链接、固定清单和人员 API，可减少权限、包生态映射与外部服务依赖。

## 边界与验收

这是带出处的技术来源与关联项目图，不承诺穷尽运行时依赖或准确推断未声明的技术影响。普通 README 项目链接标为文档引用，人员关联标明是谁的项目；标签和 Star 只决定展示优先级，不作为质量结论。界面显示采样、预算与缺失说明。

测试覆盖来源抽取、排序、人员身份、公开范围、预算与终止、缓存重启、任务隔离、CSRF、认证失效；浏览器验证自动一级处理、真实阶段进度、手动扩展、证据阅读、稳定布局、工作台路由、手机与既有导航。实际结果保留于 [验收记录](../acceptance.md)。
