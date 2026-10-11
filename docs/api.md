# 前后端接口

同源 `/api`，错误返回 `{error:string,code:string}`。写入携带 `/api/session` 返回的 `X-CSRF-Token`；账号失效返回 401，GitHub 限额返回 429，上游连接失败返回 502。

| 请求 | 返回 / 行为 |
| --- | --- |
| GET `/api/session` | `{user:null\|{login,name,avatar_url,html_url},oauthConfigured:boolean,csrfToken:string}`；不含凭据 |
| GET `/api/auth/github` | 已连接则跳转 GitHub 授权；未连接则进入 `/api/setup/github` |
| GET `/api/setup/github` | 仅本机开发：自动向 GitHub 提交 App manifest 的 HTML 页面 |
| GET `/api/setup/callback?code=&state=` | 校验注册 state，兑换 code、持久保存连接，然后进入授权流程 |
| GET `/api/auth/callback` | 交换授权码，成功跳转 `/`；失败 `/?auth_error=<code>` |
| POST `/api/logout` | 清除会话，204 |
| POST `/api/gitube` | Gitube 的受限具名操作，返回 `{data,meta?}`；查询也需 CSRF，匿名可 searchMany / repository，其他操作需登录 |
| GET `/api/feed` | `{items:Repo[],hasMore:boolean,source:'github'}` |
| GET `/api/repos/:owner/:repo` | `{repo:Repo,defaultBranch:string,readme:{content,path,html_url,download_url}\|null,readmeError:{code,message}\|null}`；可加 `refresh=1` |
| POST `/api/graph/:owner/:repo` | `{refresh?:boolean}`；访客也需 CSRF。返回异步 GraphJob，进行中 202、缓存终态 200 |
| GET `/api/graph/jobs/:id` | 创建会话可读的 GraphJob；其他会话或未知 ID 404；认证失效返回 401 并清会话 |
| GET `/api/recommendation-profile` | 当前登录账号的兴趣画像；可加 `refresh=1` 强制重新分析 |
| GET `/api/starred?page=1` | 登录用户的 `{items:Repo[],hasMore:boolean}`，每页 100 |
| GET `/api/starred/:owner/:repo` | `{starred:boolean}` |
| PUT `/api/starred/:owner/:repo` | 登录后 Star，204 |
| DELETE `/api/starred/:owner/:repo` | 登录后取消 Star，204 |

OAuth 失败码按阶段划分：`exchange_*` 是授权码兑换，`identity_*` 是读取账号，`session_failed` 是会话保存。`connection` / `timeout` 表示该阶段连接失败 / 超时，`upstream` 表示上游服务或限流，`rejected` / `unauthorized` / `forbidden` 表示授权拒绝、凭据失效或权限拒绝，`invalid_response` 表示返回格式异常。前端显示固定中文说明，不回显未知查询参数。诊断日志仅包含固定阶段 / 分类、HTTP 状态及传输错误码白名单；不包含原始异常、客户端密钥、授权码、state、Token 或上游正文。兑换 POST 不自动重试，用户重新发起登录取得新的授权码。

认证会话保存或轮换失败时清理认证字段、销毁会话并清 Cookie，禁止重定向时隐式重写已经失败的认证保存。外部 session store 若写入与清理同时故障，需由该存储恢复机制处理残留；默认本机内存存储不涉及这项外部故障边界。

默认 Gitube 前端通过具名操作保留原有频道、多条件搜索、推荐召回、Star 列表和公开关注动态；完整输入 / DTO 见 [集成接口](gitube-integration-contract.md)。后端不接收客户端 Token、任意 GraphQL 或任意上游路径。Star 状态使用固定服务端 GraphQL 批量查询，少量缺失最多 16 项 REST 回退；操作期限 60 秒，取消后停止新增请求。关注动态明确限制最多 12 位公开关注用户各 6 个最近 Star。REST 无准确 Star 列表总数时 `total:null`；缺少统计不显示假零。以下 Feed 协议仍保留给原前端及兼容调用。

Feed 参数：`topics` 最多 5 个逗号分隔的 GitHub topic，`language` 语言名称，`q` 最多 120 字符文本，`page` 1–83，`sort` 为 `recommended` / `stars` / `updated`，可选 `range=week|month`。week 筛选七天内创建，month 筛选三十天内有代码更新；时间以服务端 UTC 为准。

搜索文本支持白名单 `topic:` 与 `language:`（语言可用双引号）；显式 qualifier 优先于对应参数。其他冒号不作为 GitHub qualifier 透传，不能覆盖服务端的公开、非归档、非 fork、超过 20 Star 限制。一次返回约 12 项，五主题时最多 15 项；各主题独立检索、交错并按 id 去重。`hasMore` 表示任一主题仍有下一页。相同公共结果缓存五分钟、最多 128 组，相同进行中检索合并；真实 Star 状态按会话单独补充。

`Repo` 包含 GitHub 的 `id,name,full_name,description,html_url,owner:{login,avatar_url},stargazers_count,forks_count,language,topics,updated_at,created_at,license:{spdx_id}|null,homepage,open_issues_count`，以及实际仓库 `cover_url`。`updated_at` 优先使用 pushed_at。登录用户另有 `viewer_starred:boolean`。跨主题热门排序基于当前已载入项目，不承诺 GitHub 全站统一排名。

GitHub App 申请 Metadata 读与 Starring 写，不发送 OAuth scope；兼容的已有 OAuth App 使用 `read:user public_repo`。两类登录均使用随机 state、S256 PKCE，state 十分钟有效且单次消费。注册采用独立的会话 state；连接信息不能由后续回调覆盖。

授权校验仍可能返回 `invalid_state`、`access_denied`、`missing_code`；首次接入错误为 `setup_invalid_state`、`setup_missing_code`、`setup_in_progress`、`setup_failed`。旧页面的 `exchange_failed` / `unavailable` 保留中文兼容提示；新回调使用上文分阶段错误。到期需要重新登录，暂未实现 refresh token 自动轮换。

账号画像只从当前服务端会话确定账号，忽略外部传入 login。结构为 `{login,generatedAt,counts:{starred,owned},limits:{starred:1000,owned:300},truncated:{starred,owned},topics,languages,starredIds,ownedIds,warnings}`。主题最多 20 个、语言最多 15 个，按权重降序；每项为 `{name,weight,evidence:{source:'starred'|'owned',repo:full_name}}`，依据只取实际贡献该主题或语言的仓库。

Star 通过带时间戳的媒体类型分页读取，owned 从 `/users/{login}/repos?type=owner` 读取公开仓库。两个来源各自分页，仅访问可信 GitHub 端点；DTO 不带 Token 或仓库源码。数量为去重后实际采样数，`truncated` 表示上限后仍有下一页。

画像按账号与 Token 摘要隔离缓存，完整结果十五分钟、部分结果一分钟，同一在途请求合并。Star 写入与注销使画像失效；一源失败返回另一源与 warnings，两源失败返回错误，任一源 401 清除本地登录会话。所有画像响应均为 `Cache-Control: no-store`。

注册 manifest 完全省略可选 `hook_attributes`，避免 GitHub 校验 loopback webhook 导致注册失败。应用不订阅 webhook 事件。

项目详情仅支持公开仓库。owner/repo 严格校验，服务端只调用 GitHub 的仓库资料与 README 固定端点，不抓取调用者提供的 URL。README 原文以 UTF-8 完整解码，最大 2 MiB；超限或无效格式返回显式 `readmeError`，不静默截断。仓库不存在返回 404；README 不存在时为 `readme:null,readmeError:null`；README 临时错误保留项目资料，401 则清理登录会话并返回错误。

已确认公开仓库的 README 若被 GitHub App 权限拒绝，可匿名重试公开端点；不新增 Contents 权限，401 与限流不回退。完整结果按仓库及 Token 摘要缓存五分钟，最多 128 项，同一请求合并；部分错误不缓存，`refresh=1` 绕过已完成缓存。`viewer_starred` 由当前会话单独补充，不写入详情缓存；状态读取暂时失败时字段缺省，Star 写入前再次核对真实状态。响应保持 `Cache-Control: no-store`。

图谱的 GraphJob / GraphResult、来源证据与边界详见 [图谱合同](graph-contract.md)。任务只自动处理一级，按真实阶段推进 progress；所有 API 响应 no-store。公开结果单独持久缓存，不含 Token、会话 ID、原始源码或 viewer_starred；强制刷新有冷却，队列、请求预算与时间均有上限。
