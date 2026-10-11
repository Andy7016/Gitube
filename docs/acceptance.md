# RepoFlow 当前验收记录

## 本次：README 链接证据与技术流向

日期：2026-10-11。来源：用户要求覆盖 Related 与版权声明中的仓库链接，并根据明确的上下游依据调整图谱箭头。规格见 [图谱合同](graph-contract.md)，设计与边界见 [ADR 0009](adr/0009-readme-evidence-and-technical-flow.md)。执行代理均为 GPT-6.1 Sol / xhigh。

- README 新增 Related / See also / Alternatives 与 Copyright / License / Attribution 段落；Markdown、引用式链接、HTML 链接和语义段落中的裸 GitHub 地址均保留实际仓库 URL 与原文行地址。引用代码仅读取 BibTeX / BibLaTeX 数据；忽略徽标、图片、普通代码与 HTML 注释 / pre / code。
- 按链接所在句子、段落 / 列表项 / 表格行及最近语义标题判定关系，局部窗口每侧最多 400 字符。明确基于、衍生、依赖或借鉴为上游；明确使用者 / 下游列表为下游；否定、比较、第三方描述或归属标题本身不强推方向。测试覆盖中英文、混合正反方向、多链接隔离、点号仓库名、重复引用行和方向冲突。
- 箭头统一为“技术来源 → 使用方”；关联、文档引用和方向冲突以不同无箭头虚线区分。来源面板按分析仓库列出方向、判据、原文与引用仓库链接。边的采集 source / target 保持原语义，结构布局与手动展开继续使用采集路径。
- 前后端共享证据关系归并；公开 DTO 白名单过滤新增字段并重算边关系。新结果标记 `semanticsVersion:2`；旧缓存可读，但访问时重新分析，不能作为新版语义缓存命中。自动一级、24 个直接目标、4 位人员、40 请求 / 90 秒与 120 节点 / 5 层上限均不变。
- 新图例缩小内嵌画布后，候选整站检查暴露四节点根圆遮盖普通节点。摄像机已移除重复的名称预留，并按圆间距限制缩放与密度；根圆保持 17px，光晕不拦截点击。新增 490×194、360×210、280×178、390×240 的居中 / 全图几何回归，圆间隙至少 3px、圆点在画布内且名称避碰。密集聚焦也遵循实际圆间距。
- 最终 `npm test` **195/195 通过**，失败 / 跳过 / 取消均为 0。新增抽取、共享关系、合并 / 缓存、SVG 箭头与小图几何回归；图谱 UI / 布局定向 **14/14** 通过。一次沙盒并行复验曾出现 6 项既有 loopback 请求 `fetch failed`，保留原日志；最终在正常联网执行环境完整复验通过。
- `npm run build:repoflow -- --outDir .artifacts/repoflow-relation-build` 与默认 `npm run build` 均 exit 0；两个前端 TypeScript 通过。最终 `dist/` 为 Gitube，入口 `index-D8knrVsC.js`，图谱 `TechnologyGraph-DGNYZ4zx.js`。
- 最终 Chrome 整站 **22/22**、关系专项 **6/6**、图谱专项 **5/5** 通过，运行时及图谱控制台错误为 0。覆盖浅 / 深主题、390px 手机、正反箭头及无向关系、原文行与目标仓库、选择居中、35 / 69 / 120 节点、真实公开缓存 42 节点、多层手动、缩放拖动全屏和独立滚动；适配视图圆点与常驻名称无交叠 / 外溢，摄像机操作无额外分析请求。四节点详情、手机方向图和密集聚焦截图已人工复核。
- 整站候选为 19/22，其中两项为上述小图问题，一项为脚本在后台任务结束前开始计数的计时问题。脚本改为等待明确 100% 终态后验证无循环请求；仍保留原有请求数量与无重试循环断言。关系专项逐节点检查前切回全图，以点击真实可见圆点，未使用 force。
- 使用定稿后端实际采集公开 `ggml-org/llama.cpp`：**9 节点 / 8 边 / 22 请求**，其中上游 1、关联 1、普通引用 6。真实 README 第 74 行的 “build on top of” 明确生成 `ggml → llama.cpp`，第 16 行普通提及保留独立证据；结果为完成的部分覆盖，说明人员仅采样前 4 位。没有将采样结果描述为完整源码依赖图。

原始证据保留在被忽略的 `.artifacts/graph-relations-tests-final.log`、`graph-relations-tests-sandbox-retry.log`、`graph-relations-integration-candidate-results.json`、`graph-relations-integration-browser-results.json`、`graph-relations-20261011-results.json`、`graph-relations-layout-final-results.json`、`graph-relations-live-api.json` 及相应脚本 / 截图。生产仍只访问真实 GitHub；浏览器隔离 fixture 不写入产品。后端已在正常联网环境重启以加载新规则，预览仍为 `http://127.0.0.1:5173`，既有浏览器会话可能需要重新登录。本轮未读取或修改 App 凭据，未代用户完成真人 OAuth 或真实 Star 写入。

## 历史：分支布局、topic 大小与摄像机聚焦

日期：2026-10-11。来源：用户提供的两张多层图谱截图与节点大小、名称阈值、邻域淡化和摄像机居中要求。规格见 [图谱合同](graph-contract.md)，取舍见 [ADR 0008](adr/0008-graph-branches-and-camera.md)。执行代理均为 GPT-6.1 Sol / xhigh。

- `src/graph-data.ts` 按实际来源边的根可达最短路选择稳定结构父节点，递归打包完整子树。手动展开的父节点随整个分支外移，共享项目仍只有一个位置且保留全部真实来源边；不将 `overlapRoot` 当作结构父节点。未展开同档子项保留 topic / Stars / 名称的近远顺序。
- 节点面积基于真实 topic 重合度，语言回退与无标签保持最小相似度尺寸；根突出。至少 30%、根、选中节点和展开父节点常驻完整名称；移除②③数字徽标，面板显示来源父节点与层级。选择后突出一阶邻域，其他节点 / 箭头淡化。
- `src/TechnologyGraph.tsx` 增加选中居中、聚焦 / 全图切换和展开后的重新聚焦，保留缩放、拖动、全屏、键盘与以节点为新根。摄像机不额外发起分析。节点列表或图上选择后，来源面板滚动归零。
- 首轮固定 CSS 尺寸导致 35 节点窄预览与 120 节点概览挤压。最终增加统一密度缩放和确定性屏幕标签避碰，保留全部应显示名称，移位标签通过无箭头细引线关联；常驻名称可直接点击选择。聚焦后恢复较大的节点与字号。
- `npm test` **171/171 通过**，失败 / 跳过 / 取消均为 0；新增 `tests/graph-layout.test.mjs` 的 **7/7** 覆盖输入顺序稳定、最短路父归属、共享 / 环关系输入不变、topic 面积与语言回退、排名、分支隔离、5 层单链及 120 / 5 上限。
- 定稿 `npm run build:repoflow` 与 `npm run build` 均 exit 0。最终 `dist/` 为 Gitube，入口 `index-bxqVeoCw.js`，图谱 `TechnologyGraph-DlDM-X3x.js`；TypeScript 与变更空白检查通过。
- 最终 Chrome 图谱专项 **5/5**、整站回归 **22/22** 通过，运行时 / 图谱控制台错误均为 0。专项验证真实屏幕坐标居中、29 / 30 / 80% 标签、语言回退、邻域透明度、两支手动到三级、全图 / 聚焦、拖动、缩放、全屏、resize、432px 桌面 / 620px 手机内嵌高度和独立滚动。文字点击居中误差 0px，无新增分析请求；多层手动恰好 5 次一级任务，无自动递归。
- 实测 35 节点预览、69 节点三级分支、120 节点概览、手机 35 节点、公开缓存 CodexBar 42 节点：圆 / 常驻标签交叠及画布外溢均为 **0**；常驻名称保留 20 / 34 / 84 / 20 / 4 个。前三组最小圆间隙约 2.50px，实际缓存图约 14.87px。密图聚焦节点半径 14.40px、标签高 14px；深浅主题与手机截图已人工复核。
- 原整站脚本有两处按 SVG `g` 的包围盒中心点击；名称移位后该位置可能是空白，改为不带 force 的实际圆点点击，全部业务断言保持。候选 20/22 与最终 22/22 证据分别保留。120 节点最终性能观察最长长任务 62ms，超过 100ms 为 0；此为本机当次观测，不作为性能保证。

原始证据位于被忽略的 `.artifacts/graph-visual-20261011-r3-results.json` / `r3-check.mjs` / `r3-*.png` 与 `graph-presentation-final-browser-results.json` / `final-check.mjs`；r1 / r2 和整站候选证据保留。本轮未重启已登录的服务，预览仍为 `http://127.0.0.1:5173`。自动一级、120 节点 / 5 层、服务端采集预算与推荐算法保持既有规则。验证采用隔离 API fixture 和既有公开缓存快照，生产仍抓取实际 GitHub；未代用户操作真实 Star，未宣称重新完成真人 OAuth 或跨浏览器验收。密集小预览的普通圆可小于 2px，常驻名称、聚焦、缩放与可访问节点列表共同提供选择和阅读入口。

## 历史：GitHub 登录 unavailable 故障

日期：2026-10-11。来源：用户实际登录后看到 `GitHub 登录失败：unavailable`。补充 [ADR 0003](adr/0003-account-signals-and-webhook-free-setup.md) 的运行边界，执行代理保持 GPT-6.1 Sol / xhigh。

- 确认原 5173 服务运行于禁止联网的沙盒身份；该进程静态页面 200、具备既有 App 配置，但隔离会话的无效授权码回调在 0.00 秒内返回 `unavailable`。另一个正常执行环境的匿名 GET / POST 连接均可用，不能据此代表原服务可联网。
- 核实并停止原项目监听进程，以正常联网身份启动同源服务。对同一隔离负向流程，约 1.47 秒收到 GitHub HTTP 200 授权拒绝响应，前端回跳码为 `exchange_rejected`，未建立登录。这证明服务端换令牌端点已经连通，未将无效授权码当作真实成功登录。
- 登录跳转仍为 `github.com/login/oauth/authorize`，回调为 `http://127.0.0.1:5173/api/auth/callback`，state、PKCE S256 和最小权限保持。没有调整代理、修改应用凭据或请求新增权限。本机凭据文件长度与修改时间均未改变，内容未输出。
- OAuth 错误按兑换 / 身份 / 会话分类，显示固定中文提示；兼容旧 `unavailable`，未知 URL 参数不回显。安全日志仅固定阶段、分类、HTTP 数字及传输码白名单；会话保存失败清理认证字段与 Cookie，禁止隐式重写失败的认证保存。
- 定向 OAuth / 注册测试 **57/57 通过**；完整 `npm test` **164/164 通过**，失败、跳过、取消均为 0。覆盖连接 / 超时 / 服务 / 限流 / 响应格式 / 401 / 403、诊断不泄漏、不可重放、会话保存或轮换故障及保存已写入却返回错误的边界。
- 默认 `npm run build` 通过，定稿入口 `index-COCK40eB.js`。在该生产资源上登录 / 401 / 退出浏览器回归 **3/3**，新中文提示与恶意未知参数回归 **5/5**，运行时错误均为 0。错误查询参数被移除，其余查询与 hash 保留。浏览器回归采用隔离 fixture，没有真实账号写入。
- 补充根 `AGENTS.md` 与运行说明，持久 GitHub 预览须使用允许联网的上下文，不能以模拟浏览器或静态页面通过代替真实服务请求。修复后服务继续运行于 5173；向用户请求重新登录确认，不在其授权过程中重复重启。
- 用户随后于 2026-10-11 重新操作真实 GitHub 登录，并明确回复“登录成功”。真实账号授权与返回本站登录流程由用户本人确认通过。

证据在被忽略的 `.artifacts/login-network-retest.json`、`login-backend-tests.log`、`login-browser-results.json`、`login-toast-results.json` 与 `login-toast-*.png`；真实登录成功的证据为本次用户反馈。边界：本轮没有验证真实 Star 写入；负向连通测试和模拟回归本身不代表真实授权成功。外部会话存储若认证写入和清理同时失败，需由存储恢复机制处理残留。

## 历史：重建版 Gitube 拉取与本地合并

日期：2026-10-11。来源：用户要求拉取移除旧身份信息后的 Gitube，再合入既有实现。当前上游 `418daee527607dd0a97b1c8d675bf0a7a4895ecf`；决定见 [ADR 0007](adr/0007-rebuilt-upstream-history.md)。执行代理为 GPT-6.1 Sol / xhigh。

- 全新克隆重建版并逐字节比较：业务源码、依赖与配置一致，变动仅为两份 README 与新增截图。保留既有 Gitube UI 适配、同源 GitHub 认证、账号画像、完整 README、自动一级 / 手动继续追溯和独立图谱入口；更新来源、截图及许可证。
- 当前项目建立根 Git 仓库，`integration/auth-graph` 基于新的 `origin/main`；新历史共 4 个提交，与旧克隆的提交集合交集为 0。新上游 author / committer 邮箱均为 GitHub noreply。旧本地上游缓存清理后，当前来源文档不再保留旧提交链接。
- 按已知旧身份检查当前可纳入文件和新 Git 对象，匹配数量为 0；根 `.local/`、`.artifacts/`、`node_modules/`、`dist/` 和独立实验 `oneshot-astra/` 不纳入 Git。本机 App 凭据未修改：文件长度与修改时间保持不变，未读取或输出内容。未创建带本机身份的提交，未推送远程。
- 顺序实跑 `npm run build` → `npm run build:repoflow` → `npm test` → `npm run build`，全部 exit 0。后端 **140/140 通过**，失败 / 跳过 / 取消均为 0。最终 `dist/` 为默认 Gitube，入口仍是 `index-DN3i_p_0.js`。
- 当前最终产物上完整 Chrome 浏览器回归 **22/22 通过**，运行时错误 0；覆盖访客 / 登录入口、搜索、完整安全 README、自动进度 / 手动 / 独立图谱、画像覆盖信息、收藏迁移、Star 失败回滚、会话失效、晚响应隔离、返回滚动、主题及手机布局。桌面与手机截图复核通过。
- 定稿同源服务继续运行在 `http://127.0.0.1:5173`。浏览器回归的 GitHub 响应为隔离 fixture，生产应用仍读取真实 API；本轮未代用户完成真人 OAuth 或真实 Star 写入。上游桌面源码保留，但没有宣称安装包或静态 Pages 已接入后端。

原始证据：被忽略的 `.artifacts/rebuilt-validation.json` / `.log`、`rebuilt-browser-results.json`、`rebuilt-upstream-merge.json` 及 `rebuilt-*.png`。已知旧身份扫描不是对未知个人信息或第三方服务器缓存的全面保证。

## 历史：Gitube 前端集成

日期：2026-10-10。来源：用户提供 Andy7016/Gitube 并要求合入已有认证与技术追溯。当时参考重建前的上游；2026-10-11 已按 [ADR 0007](adr/0007-rebuilt-upstream-history.md) 更新来源并停止保留旧提交链接。本节保留当次功能验收结果，范围见 [集成接口](gitube-integration-contract.md) 与 [ADR 0006](adr/0006-gitube-frontend-integration.md)。所有执行代理继续 GPT-6.1 Sol / xhigh。

- 默认构建使用 `gitube/`，原 `src/` 保留；`npm.cmd run build:repoflow` 实际通过。最终 Gitube `npm.cmd run build` 的 TypeScript / Vite 通过，入口 `index-DN3i_p_0.js`，约 360.65 kB；README 与图谱独立分包。定稿后额外 TypeScript 检查、服务入口语法检查均通过。
- 新增具名服务端桥接，浏览器不接收 Token / 任意 GraphQL。匿名搜索和详情可用；真实 Star、画像和关注动态按服务端会话处理。固定批量 Star 查询、公开字段校验、URL 校验、分页边界、取消和 60 秒期限有风险测试。测试发现的 `Sec-Fetch-Site: cross-site` 边界已补入 CSRF 校验。
- 新增 Gitube API 测试 24/24；完整 `npm.cmd test` 为 **140/140 通过、0 失败 / 跳过**。未调用真实账号写操作。
- Chrome 生产界面共有 22 个独立验收项，累计全部覆盖通过。真实轮次为候选 19/22，最终冻结产物定向 6/6；前三项分别为画像限额数字提示、深色输入框层叠，以及构建窗口暂时缺失 dist 导致 ENOENT，均已定向解决。不是声称一次完整最终 22/22 运行。
- 验证浏览器 GitHub 登录跳转、无 PAT / 浏览器凭据、访客项目流与搜索、完整安全 README / 相对资源 / 锚点、详情图谱自动进度 / 一级结果 / 手动扩展 / 独立入口、主题、快捷键、多收藏夹、稍后再看、历史、搜索后退与刷新详情后返回、401 恢复及旧账号请求隔离、移动端无页面横溢。验收脚本的账号与写响应是测试 fixture，不进入产品。
- 旧 RepoFlow 收藏、稍后再看、历史与可识别兴趣按 guest / GitHub 账号非破坏导入，保留原键；已有目标优先。缺少原操作时间保留 `at:null` 并标注“时间未知”，不拿导入时间伪造历史。损坏存储不会阻断公共浏览。
- 实际人工复核桌面 / 手机 / 深色截图；图谱内部证据滚动不推移 README。深色标题与节点标签测得对比度分别约 14.58 / 15.84，输入框、描边和证据按钮已适配。
- 真实只读 API 验证：匿名新搜索返回 3 个实际项目、真实总数 7960；Andy7016/Gitube 元数据 200、完整 README 5647 字符；karpathy/minGPT 图谱返回 partial、33 节点，明确说明发现 11 人而只展开 4 人。
- 额外真实 Chrome 首页复验加载 18 张实际项目卡片（包括 transformers、ollama、Compositor），0 运行错误、无页面横溢，截图 `integration-real-home.png`，没有拦截或替换 API。首次尝试在 65 秒内未出现卡片；当时未保留上游失败响应，无法确认原因。加入请求诊断后复验通过，保留这次网络/加载不稳定事实，不将原因推断为已经查明。
- 实测 Windows 拒绝开发端口 3001（EACCES），5314 可绑定；默认开发 API 与两个 Vite proxy 已统一修复。实际 5180 临时开发前端到 5314 代理验证 HTML / 会话 / TSX 转换 200、合法同源 CSRF 通过且未知具名操作 400。开发 StrictMode 的搜索、排序、错误重试、详情与返回单组 1/1 通过，0 运行错误。临时开发服务已停止，仅保留正式本地 5173 服务。
- 热门项目熟悉度与发现价值只记录为 [后续调研](recommendation-research.md)，本次未实施新降权策略。图谱固定显示上限 120 节点 / 手动 5 层，自动一级；单次采集范围沿用 24 个直接来源、4 人各 100 仓库、40 请求 / 90 秒。

可再生成的脚本、轮次 ledger、截图与实际只读结果位于被忽略的 `.artifacts/`（`gitube-acceptance-summary.json`、`gitube-browser-check.mjs`、`integration-live-smoke.json`、`integration-dev-proxy-check.mjs`）。关键结果已保存在本文件。

验证边界：真人 OAuth 同意与真实 Star 写入仍由用户操作；本次没有替用户授权、关注作者、写入真实账号，也没有发布 GitHub Pages / Tauri 或改写现有 GitHub App 凭据。浏览器覆盖 Chrome，未验收 Firefox / Safari。画像既有收集本身仍最多 13 页，不支持随外层请求立即取消；具名操作响应有独立期限。公开关注动态限 12 人 × 6 项，不代表全体关注；未增加公共搜索缓存或自定义社交预览图 GraphQL 查询。

## 历史：技术来源图谱

日期：2026-10-10。来源：用户追加的引用树、开发技术图谱、自动一级与手动后续追溯要求。合同见 [图谱规格](graph-contract.md)，设计与取舍见 [ADR 0005](adr/0005-technical-provenance-graph.md)。所有执行代理采用 GPT-6.1 Sol / xhigh。

- 详情页自动在独立框体启动一级分析；侧栏入口和 `/graph/:owner/:repo` 提供独立工作台。进度圆环由实际后台阶段驱动，有界轮询，换项目或账号取消旧请求。
- README 技术致谢、引用、普通项目提及、明确 GitHub 依赖及人员关联分别保留证据。核实 CODEOWNERS、README 维护者、主要贡献者和个人所有者；自动只读当前中心的来源，不递归读取外围项目 README。
- 直接来源内档、人员关联外档；Jaccard topic 重合度、Star、仓库名决定同档稳定远近。无 topics 时显式说明主要语言回退；手动扩展保留每个节点的比较基准，去重、防环，最多 120 节点 / 5 层。
- 队列、会话在途数量、40 次请求预算、90 秒期限与 2 秒缓存写入等待均有上限。完整公开结果缓存 24 小时、部分结果 5 分钟，原子写入本机；公开 DTO 严格重建字段类型，不持久化令牌、账号 Star 或原始正文。缓存异常、超时和限流均保留可用结果与覆盖说明。
- 最终 `npm.cmd test`：116 项通过、0 失败；包含 22 项图谱模块测试、8 项图谱 API 集成及调用方取消测试。覆盖来源提取、优先级、人物角色、公开限制、排序、合并、预算、期限、并发与队列、缓存 TTL / 冷却 / 原子写入、永不完成的存储、终态一致性、CSRF、任务会话隔离和 401 清会话。
- 最终前端 TypeScript 与 Vite 生产构建通过。图谱模块按需加载，独立 JavaScript 约 24.44 kB。嵌入框与 Suspense 占位按相同断点保持固定高度，避免异步加载推移 README；SVG 根据真实画布尺寸补偿文字和节点命中范围。
- 新增图谱浏览器 15 组通过，运行时错误 0：自动一级与 CSRF、真实圆环阶段与终态停止轮询、层级/重合度/Star 稳定远近、证据与人物、手动扩展去重防环、独立输入与路由、缓存、部分失败、失败重试、空结果、401、路由及退出晚响应隔离、缩放平移重置、手机布局和原详情返回。另定向验证了手动节点的相似度比较基准。
- 原有 43 组项目流、画像、会话、详情和历史边界检查再次全部通过，运行时错误 0。保留完整 README、安全渲染、按钮操作、账号隔离、过滤分页与严格滚动恢复断言。
- 实际公共 GitHub 采集 `karpathy/minGPT`：4 个直接来源、28 个开发者关联项目、11 位公开贡献者中扫描 4 位、252 个公开仓库候选，使用/预留预算 19/40。部分结果说明人员采样范围；该项目无 topics，真实走 Python 主要语言回退。再次请求复用相同数据时间的完成缓存。没有代用户登录、注册或写入 Star。
- 定稿同源服务与真实浏览器 `/graph/karpathy/minGPT` 再次完成实际采集，33 个节点、4 个直接来源、28 个关联项目均显示；选中 Transformers 后可查看实际 README 引用与语言回退依据。真实桌面/390px 手机截图已检查，无页面横向溢出、运行时错误 0。移动内嵌框定向复验通过，外围节点与中心至少 6px 空隙、最下节点含标签与底部说明至少 4px 留白；最终预览仍为 `http://127.0.0.1:5173`。

浏览器可重复性数据仅存在于 `.artifacts/` 验收脚本，生产应用全部访问实际 GitHub 数据。边界：这是有证据的技术来源与关联图；普通包名不会猜测仓库，任意外部论文链接不会自动推断对应代码，人员与依赖采用明确上限的公开采样；完整 TOML 语法及跨进程共享缓存不属于当前覆盖范围。

## 上一轮：独立详情页与完整 README

日期：2026-10-10。来源：用户关于弹窗详情、完整 README 与按钮操作的反馈；决策见 [ADR 0004](adr/0004-project-pages-and-full-readme.md)。

- 详情弹窗已替换为 `/project/:owner/:repo` 独立页面；封面和标题是真实链接。支持直接访问、刷新、新标签页、浏览器前进/后退，返回时恢复筛选、已加载列表和位置；刷新详情再返回也已验证。
- 操作区提供稍后再看、Star、收藏、复制详情链接及显著的打开原仓库按钮。Star 写入复用真实 API / CSRF 与成功后更新规则；复制失败提供可选择的地址。
- 新接口读取公开仓库完整 UTF-8 README，404、私有仓库、正文缺失、正文临时失败、超限与会话过期分别处理。保持最小 GitHub App 权限，公开 README 权限 403 可匿名重试，401 与限流不绕过。
- `npm.cmd test`：85 项通过、0 失败，包括新增 25 项详情服务测试与 4 项详情 API 集成测试。覆盖完整非 ASCII 文本、2 MiB 边界、无效 Base64 / UTF-8、缓存、并发、账号 Token 隔离、权限回退、Star 状态及 401 会话清理。
- 定稿 `npm.cmd run build` 通过。详情及 Markdown 按需分包，首页 JS 约 267 kB，详情分包约 356 kB，无超过 500 kB 的构建提示。
- 18 组详情浏览器检查通过、运行时错误 0：独立路由与原生链接、完整 Markdown、HTML 清洗、表格/任务列表/折叠、相对及仓库根资源、目录/脚注/自定义锚点、列表位置恢复、刷新后返回、稍后再看/收藏持久化、复制成功/失败、访客登录提示、Star 成功/失败/取消、缺失/错误/重试、快速导航响应隔离、401 清账号及手机布局。
- 原有 23 组项目流、画像和会话浏览器检查已适配并通过；无演示数据或宣传区域回归。浏览器可重复性 fixture 只存在于验收脚本，应用全部使用真实 GitHub 数据。
- 另有 2 组历史导航边界通过：账号 A 进入详情后切换 B 并刷新，后退不会恢复 A 的候选、收藏或 Star；分页筛选列表→详情 A→topic 列表→详情 B 的逐级后退恢复各自筛选、分页内容与滚动位置，无额外检索。修复了异步详情渲染导致的 560→763px 偏移，严格位置断言保持不变。最终 18 组详情复验也全部通过；合计 43 组浏览器交互检查、运行时错误 0。
- 实际同源服务 `GET /api/repos/facebook/react` 返回 200，完整 README 为 5,317 UTF-8 字节；实际详情页面及封面成功加载。桌面与 390px 手机 README 截图已检查，移动端无横向溢出。Markdown、图片、代码和操作区可正常阅读。
- 当前预览以 `npm.cmd start` 提供定稿构建，地址仍为 `http://127.0.0.1:5173`。此机器的 3001 开发端口被操作系统拒绝绑定（EACCES），故验收使用同源启动；启动失败现在明确报错并返回失败状态，避免打印误导性的成功信息。

验证边界：真实公共资料与 README 已联网验证；真实账号授权和 Star 写入仍由用户本人操作，自动验收使用隔离测试账号。正文超过 2 MiB 或无法完整 UTF-8 解码时明确提示到原仓库查看，不会静默截断。

## 上一轮：注册修复与账号推荐

来源：用户实际 GitHub 注册截图（loopback hook 被拒绝），及基于历史 Star / 本人仓库推荐的追加要求。实现决策见 [ADR 0003](adr/0003-account-signals-and-webhook-free-setup.md)。

- 注册 manifest 已完全省略 `hook_attributes`，每次注册表单的测试均断言不含此配置，避免只禁用 webhook 仍触发 GitHub 的公网 URL 校验。修复后本地浏览器再次验证登录跳转所提交的实际 manifest 不含 webhook。
- `npm.cmd test`：56 项通过、0 失败。新增 11 项画像服务测试及 3 项 API 集成测试，验证第二页信号、旧 Star、owned/语言贡献、权重、去重、截断、两源失败、部分结果与 TTL、401 会话清理、账号/Token 隔离、并发合并、失效竞态、缓存淘汰、认证和写入后更新画像。
- 定稿 `npm.cmd run build` 通过，TypeScript 和生产资源生成正常。
- 浏览器原有 14 组交互检查通过；新增 7 组画像检查通过：自动检索变化、真实来源依据/已知项目排除、全站搜索、刷新失败重试、无 topic 的语言推荐、手选兴趣不被覆盖、首次读取失败仍可浏览公开项目。
- 另有 2 组会话检查通过：画像 401 后清除 UI 账号并重读会话；旧账号慢响应不能覆盖新账号画像。合计 23 组浏览器交互检查，运行时错误 0；390px 画像状态与页面无横向溢出。
- 当前本地预览进程已重新启动，使用定稿构建与新服务代码。交互测试仅使用测试账号/画像响应和真实公共 API 仓库快照，应用没有加入演示数据。

边界：已核对 GitHub 官方 manifest 可选字段及账号 Star/公开仓库 API 文档。没有代用户提交真实 GitHub 应用注册或完成其账号授权，因此本次确认的是移除被拒绝的 hook 配置与本地流程，尚未宣称真实账号端到端授权成功。历史 Star 指当前保留的 Star，无法恢复已取消 Star 的完整历史；推荐有明确采样上限，不读取私有源码。

## 上一轮：YouTube 式项目流

日期：2026-10-09。对应 [当前规格](specification.md) 与 [ADR 0002](adr/0002-youtube-feed-and-github-app.md)。

- `npm.cmd test`：42 项通过，0 失败。覆盖既有授权与 Star 风险，以及 manifest 最小权限、注册 state 绑定/单次/过期、本机/Host/跨站限制、失败不保存、凭据禁止覆盖、重启恢复、并发独占写入、搜索 qualifier 与时间窗口。
- `npm.cmd run build`：TypeScript 与 Vite 生产构建通过；`node --check server/index.mjs` 通过。
- 停止开发服务后实际运行 `npm.cmd start`，同一 `127.0.0.1:5173` 下 HTML、构建 JavaScript、SPA 路由返回 200，未知 API 返回 404 JSON，首次接入 manifest 回调仍为 5173，无需改文件切换启动方式。
- 真实公共 GitHub API `/api/feed?topics=artificial-intelligence,web-development,developer-tools&page=1` 返回 200、12 个项目、source=github；包含 Significant-Gravitas/AutoGPT、Developer-Y/cs-video-courses、affaan-m/ECC。没有使用应用内演示数据。
- Chrome 浏览器 14 组检查通过：真实项目显示且无 Hero/演示切换、提交搜索、空结果、时间与语言参数、收藏和稍后再看刷新保留、详情/历史/焦点/Escape、隐藏撤销、访客 Star 单层登录提示、偏好持久化、API 失败重试、连续分页去重、访客与两个账号隔离、CSRF Star 写入/失败保持/取消、折叠侧栏与 390px 手机抽屉。运行时错误 0，手机无横向溢出。
- 另用真实本地服务验证「GitHub 登录」点击后到 `/api/setup/github`，浏览器向 GitHub 注册 URL 发出 POST，包含正确回调、随机 state 和 Metadata read / Starring write manifest。测试在 GitHub 请求离开浏览器前拦截，未创建真实应用。
- 浏览器交互检查为可重复性使用真实 API 获取的仓库快照和测试用账号/写入响应；应用代码不包含这些测试 fixture。实际外部封面可能被 GitHub 限流，已添加一次错开时间的缓存地址重试，最终失败明确标示不可用。
- 移除了外部字体加载依赖，使用系统字体回退。截图及可再生成的浏览器检查脚本保存在被忽略的 `.artifacts/`。
- 最终真实页面检查已连续载入 23 个去重项目，23 张实际 GitHub 封面成功加载，无不可用封面和 JavaScript 错误；重新检查桌面五列及 390px 手机截图，手机无横向溢出。该结果是当次网络验证，不保证上游封面持续可用。

验证边界：没有代用户完成 GitHub App 注册、真实账号授权或真实 Star 写入。成功兑换及写入以模拟 GitHub 集成测试验证；正式部署 HTTPS、共享会话和 Token 自动续期未做部署验收。

## 第一版历史验收

以下保留最初演示版的历史结果，演示模式与手动配置方案已被 ADR 0002 取代。

日期：2026-10-09。对应需求：[规格](../.scratch/repoflow/spec.md)，实现决策：[ADR 0001](adr/0001-github-auth-and-recommendations.md)。

## 已验证

- Node 22.22.0；依赖安装成功并生成 package-lock.json。当前机器默认 npm 镜像和 npm 官方源分别出现连接重置、超时；显式使用 `npm install --registry=https://registry.npmmirror.com --fetch-retries=1 --fetch-timeout=20000` 安装 165 个包成功，未修改全局配置。
- `node --check server/app.mjs`、`server/github.mjs`、`server/index.mjs` 通过。
- `npm test`：23 项通过，0 项失败。覆盖 OAuth state / PKCE、身份校验、会话轮换、HttpOnly Cookie、Token 不出现在客户端、未登录拒绝、CSRF / Origin 验证、Star / 取消 Star、主题独立检索交错去重与缓存、分页、401 会话清理、429 / 502、注销。
- 本地 API 真实读取 `/api/feed?topics=artificial-intelligence,web-development,developer-tools&page=1`：200，来源 github，12 个项目，hasMore=true。前六项依次包含 AutoGPT、cs-video-courses、ECC、prompts.chat、awesome-scalability、ponytail，验证多个兴趣交错返回。
- 本机 Chrome 154 可用于浏览器验证。

## 浏览器与构建

- `npm run build`：TypeScript 检查与 Vite 生产构建通过。构建产物可由 `npm start` 提供。
- 独立 Express 进程提供构建产物检查通过：HTML 200、JavaScript 资源 200、前端路由 `/discover` 200、未知 API 404 JSON。
- Chrome 实际浏览器完成 13 组检查：初始演示、搜索与空状态、收藏刷新保留、演示 Star / 取消、主题和语言筛选、趋势排序和分页、兴趣及语言改变推荐排序并持久保存、隐藏恢复、详情 Tab 焦点约束和 Escape、未配置 OAuth 说明、真实 GitHub 公共数据与访客 Star 提示、模拟账号下的 CSRF 写请求/失败保持状态/取消 Star、演示及访客和不同账号收藏隔离、390px 导航与弹窗布局。
- 浏览器捕获的 JavaScript 运行时错误为 0；390px 无页面横向溢出。桌面与手机截图已人工检查，卡片封面、侧栏、推荐流和弹窗布局正常。增大了桌面卡片正文字号并改善文字对比度。
- 浏览器脚本及截图位于本地 `.artifacts/`，该目录为可再生成的临时验收材料；关键结果保留在本文件。浏览器脚本使用当前机器随 Codex 提供的 Playwright 与 Chrome，不是项目安装前提。

## 验证边界

未提供 OAuth App client ID / secret，因此没有以真实 GitHub 账号登录或写入 Star。相关流程使用本地模拟 GitHub 的集成测试验证。生产 HTTPS / Secure Cookie、共享会话存储、OAuth Token 到期和上游缓存实际时间窗口未做部署验证。
