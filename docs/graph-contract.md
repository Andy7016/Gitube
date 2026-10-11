# 技术来源图谱接口与实施规格

来源：2026-10-10 用户追加的技术路线图谱需求。独立于推荐模块，详情自动处理一级，支持手动继续追溯与独立页面。

## 接口

- `POST /api/graph/:owner/:repo`，JSON `{refresh?:boolean}`，访客也可使用，需会话 CSRF / 同源验证；返回 202（进行中）或 200（已完成缓存）的 Job。
- `GET /api/graph/jobs/:id`，仅创建该任务的会话可读取。未知或其他会话返回 404。不会返回 Token、会话 ID、缓存密钥或原始上游错误。
- `/graph/:owner/:repo` 独立前端入口。详情页有独立框体自动启动；图谱独立页面也可输入 GitHub 仓库 URL 或 owner/repo。

Job：

```ts
type GraphJob = {
  id: string; rootFullName: string;
  status: 'queued'|'running'|'complete'|'partial'|'failed';
  phase: 'queued'|'repository'|'references'|'people'|'related'|'ranking'|'done';
  progress: number; // 0..100，按实际完成阶段推进，不代表剩余时间
  message: string; requests: number; requestLimit: number;
  updatedAt: string; result: GraphResult|null;
  error: {code:string;message:string}|null;
};
type Evidence = {
  kind: 'credit'|'citation'|'dependency'|'copyright'|'readme-reference'|'readme-related'|'contributor'|'codeowner'|'readme-maintainer'|'owner';
  url: string; label: string; excerpt?: string; person?: string;
  relation?: 'upstream'|'downstream'|'related'|'reference'|'ambiguous';
  relationReason?: string; targetUrl?: string;
};
type GraphPerson = {
  login: string; avatar_url: string; html_url: string;
  roles: ('contributor'|'codeowner'|'readme-maintainer'|'owner')[];
  contributions: number|null; evidence: Evidence[];
};
type GraphNode = {
  id: string; // canonical full_name 小写
  repo: Repo; // 与既有 DTO 相同，但无 viewer_starred
  tier: 0|1|2; // 中心、直接引用、开发者关联
  overlap: {score:number;shared:string[];method:'topics'|'language-fallback'|'none'};
  evidence: Evidence[];
};
// source/target 是采集路径，不是技术流向。
type GraphEdge = {source:string;target:string;kind:'direct'|'related';relation?:Evidence['relation'];evidence:Evidence[]};
type GraphResult = {
  version:1; semanticsVersion?:2; root:string; generatedAt:string;
  nodes:GraphNode[]; edges:GraphEdge[]; people:GraphPerson[];
  warnings:string[];
  counts:{referencesFound:number;referencesResolved:number;peopleFound:number;peopleScanned:number;candidatesScanned:number};
  limits:{references:number;people:number;reposPerPerson:number;requests:number};
};
```

## 数据与排序

1. 固定 GitHub API 获取已验证公开的仓库与 README，复用现有详情服务。Markdown AST 解析标题、引用式链接、HTML GitHub 链接及来源段落中的裸地址；覆盖 Credits / Acknowledgements / Citations / References / Inspired by / 致谢 / 引用 / 参考、Related / See also / Alternatives、Copyright / License / Attribution 等段落。按 credit、citation、dependency、copyright、普通提及、Related 的顺序使用同一个目标预算。剔除自身、徽章、GitHub 导航等无关地址。
2. 检查默认分支 `.github/CODEOWNERS`、根 `CODEOWNERS`、`docs/CODEOWNERS`，按 GitHub 优先级使用首个存在的文件。团队和邮箱不猜测成人员账号。公开 contributors 按贡献次数选择人类账号；README 明确列出的维护者 / 作者及个人仓库 owner 也保留来源。
3. 读取根 package.json、pyproject.toml、requirements.txt、Cargo.toml 中明确的 GitHub 依赖地址；普通包名不猜测对应仓库。只读取固定文件，不安装包、不运行仓库代码、不抓任意 URL。
4. 最多解析 24 个直接引用、扫描 4 位相关人员各 100 个最近更新的公开自有仓库。关联项目排除 fork/归档/自身，至少一个相同 topic；中心无 topic 时可使用相同主要语言作为明确标注的回退。无标签不能伪造重合度。
5. 标签按 GitHub topics 归一化后的 Jaccard 重合度计算（交集/并集）。直接引用始终在第一档，人员关联在第二档；每档 score 降序、Stars 降序、full_name 字典序稳定排序。直接引用和人员关联重复时合并证据并保留直接档。
6. 自动只获取当前中心一级；后台任务不得自动递归读取节点 README。手动继续追溯单个节点启动另一个一级任务，前端合并节点与边并去重、防环，最多显示 120 节点与 5 层。
7. 文档链接按局部上下文与标题判定关系：`upstream` 表示目标给当前分析项目提供技术来源，`downstream` 表示目标使用当前项目，`related` 为关联，`reference` 为方向未明的提及，`ambiguous` 为待核对。明确依赖 / 基于 / 衍生等支持上游，明确使用者语境支持下游；仅有致谢、引用、版权或人员关联不推断方向。证据保留行链接、原文、目标地址与判据。箭头从技术提供方指向使用方；其他关系为无向虚线，不改变用于布局与展开的 `source/target` 采集路径。详见 [ADR 0009](adr/0009-readme-evidence-and-technical-flow.md)。

## 稳定性

- 异步任务队列、最多 2 个并行任务 / 16 个等待、单会话最多 3 个活动任务；同会话同仓库进行中任务合并。
- 每任务最多 40 次 GitHub 请求、90 秒处理期限；复用详情服务保守预留最多 3 次请求（含公开权限回退），因此 Job.requests 表示已用与预留的预算，不保证等于实际网络调用数。上游限流停止继续扫描并保留已有结果。401 任务失败且客户端清理登录；其他来源单独失败可返回 partial 与具体覆盖说明。
- 已确认公开的正文文件在 GitHub App 缺少 Contents 读权限的 403 情况下可匿名回退，401 / 限流不得绕过。公开人员仓库按 private:false 校验，不读取私有源码。
- 仅持久化公开 GraphResult（无 Token / 账号 Star / 原始源码），本机 `.local/graph-cache.json` 原子写入、最多 64 条。完整结果缓存 24 小时，partial 最多 5 分钟；强制刷新最少间隔 30 秒。任务最多保留 30 分钟 / 128 条，读取会话隔离。
- 新结果使用 `semanticsVersion:2`，边关系从白名单证据重新计算，不能由边上的自报字段覆盖。旧版缓存不冒充新版结果，访问时重新进行有界分析；旧证据在前端保守兼容，普通 credit / citation 不补猜箭头。
- 缓存写入最多等待 2 秒并受剩余处理期限限制；存储缓慢或失败保留公开结果并说明原因，不占用处理槽无限等待。缓存处理结束后一次发布终态和 100% 进度，避免中间状态被误认作完成。
- 前端轮询有次数和时间上限、卸载或换账号时取消请求，后台有独立期限；圆形进度反映服务端实际阶段。空结果、部分失败、限流、重试与缓存时间可见。
- 一级布局采用确定性的两档位置，重合度和 Stars 的顺序决定未展开的同档子项远近；手动后代按实际来源边确定结构父节点，展开分支分开放置，共享节点只绘制一次且保留其来源边。展开父节点可为容纳子树而外移，多层图距根的绝对距离不代表相似度。`overlapRoot` 仅记录相似度比较基准，不作为布局父节点。无随机 force 抖动。
- 节点面积随真实 topic 重合度增加，根节点固定突出；语言回退和无标签使用最小尺寸。真实 topic 重合度至少 30%、当前选中、根以及展开分支父节点常驻名称，移除②③徽标；来源面板说明父路径和手动层级。
- 选中突出一阶相连节点与边，淡化其余内容；摄像机聚焦和全图切换不改变根仓库或发出分析请求。SVG 图、可访问的节点列表、来源面板、缩放/平移/重置配合使用，手机不横向溢出。呈现取舍见 [ADR 0008](adr/0008-graph-branches-and-camera.md)。

验收：服务风险测试覆盖提取、去重、排序、人物证据、任务并发/预算/期限/缓存/会话隔离；API 检查 CSRF、401、公开数据限制；浏览器检查自动启动、进度、独立入口、手动追溯、防环、错误及导航回归。
