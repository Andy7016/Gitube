<p align="center">
  <img src="docs/banner.png" alt="Gitube：像刷视频一样刷 GitHub" width="100%">
</p>

<p align="center">
  <a href="https://andy7016.github.io/Gitube/"><b>打开网页版</b></a>
  &nbsp;|&nbsp;
  <a href="https://github.com/Andy7016/Gitube/releases/latest"><b>下载桌面版</b></a>
  &nbsp;|&nbsp;
  <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/Andy7016/Gitube/releases/latest"><img alt="最新版本" src="https://img.shields.io/github/v/release/Andy7016/Gitube?color=F5A800&label=%E7%89%88%E6%9C%AC"></a>
  <a href="LICENSE"><img alt="MIT 协议" src="https://img.shields.io/github/license/Andy7016/Gitube?label=%E5%8D%8F%E8%AE%AE"></a>
  <img alt="支持的平台" src="https://img.shields.io/badge/%E5%B9%B3%E5%8F%B0-%E7%BD%91%E9%A1%B5%20%7C%20macOS%20%7C%20Windows%20%7C%20Linux-161B26">
</p>

**Gitube** 让你像刷 B 站 / YouTube 一样刷 GitHub 开源项目：用 GitHub 账号登录后，首页按你的兴趣一屏一屏推项目，看到喜欢的可以一键 Star、收藏、稍后再看。

完全开源，没有自己的服务器：你的 Token 只保存在你的设备上，所有请求都直接发给 GitHub。

<p align="center">
  <img src="docs/screenshot.png" alt="Gitube 界面截图" width="100%">
</p>

## 功能

- **推荐信息流**：根据你最近 Star 的项目、自己写的仓库、选的兴趣方向、你关注的人的公开 Star，以及你在这里的操作（Star / 收藏 / 打开 / 有效阅读 / 不感兴趣）推荐项目，每张卡片标出推荐理由（「因为你 Star 了 xxx」「@某人 Star 了」「本周新星」……）。无限滚动，「换一批」刷新。
- **三种推荐模式**：首页与设置页共用「正常推荐」「换换口味」「完全随机」。每种模式分别保留本次应用运行中的列表与滚动位置，切回后继续浏览。
- **关注者权重**：在设置页调整各关注人的推荐影响，0–3 倍、默认 1 倍；0 倍不参与推荐，也不会取消 GitHub 关注。
- **频道**：推荐、关注（你关注的人最近 Star 了什么）、本周新星、本月热门，以及你选的兴趣方向（生物信息、大模型、Rust……）。
- **快捷操作**
  - 卡片右下角的星星：一键 Star / 取消 Star（真的 Star 到你的 GitHub 账号上）
  - 鼠标移到封面上：右上角「稍后再看」「收藏」
  - 「⋮」菜单：收藏到指定收藏夹、复制 `git clone` 命令、不感兴趣、不想看某个话题 / 语言
  - 详情页**长按 Star 一键三连**：Star + 收藏 + 关注作者
  - 详情页快捷键：`S` Star，`B` 收藏到…，`L` 稍后再看
- **详情页**：像视频播放页，左边是项目信息和 README，右边是相关推荐。
- **有效阅读学习**：详情页可见且获得焦点时才累计阅读时间。累计严格超过 3 分钟，或严格超过 1 分钟并通过本页打开对应原仓库，会记录一次小幅兴趣信号；同账号同仓库 24 小时最多一次，后台或失焦不计时。
- **收藏夹**（可以建多个）、**稍后再看**、**历史记录**、**我的 Star**、**搜索**（支持 GitHub 搜索语法，比如 `topic:bioinformatics stars:>500`）。
- **封面**：项目设置了社交预览图就用那张图；没有的话自动生成一张——底色是主语言的颜色，右上角的格子越亮越密，说明项目最近越活跃。
- 浅色 / 深色主题，手机浏览器也能用。

## 第一次使用：登录

**桌面版**：点「使用 GitHub 账号登录」，Gitube 会显示一个验证码。点「复制验证码并打开 GitHub」，在浏览器里粘贴验证码、点 **Authorize**，回到 Gitube 就自动登录了，不用自己生成 Token。以后想取消，可以在 GitHub 的 Settings → Applications 里撤销授权。

**网页版**（或者在桌面版里展开「用 Personal Access Token 登录」）：

1. 点登录页上的链接，打开 GitHub 生成 Token 的页面（需要的权限已经勾好：`public_repo`、`read:user`、`user:follow`）
2. Expiration 选一个有效期，拉到底点 **Generate token**
3. 复制 `ghp_` 开头的 Token，粘贴到登录页

Token 只保存在你自己的设备上，只用来直接请求 GitHub API。也可以用 fine-grained token：Account permissions 里把 **Starring** 设为 Read and write，**Followers** 设为 Read and write（一键三连关注作者用，可不开）。

## 安装桌面版

到 [Releases](https://github.com/Andy7016/Gitube/releases) 下载：

| 系统 | 文件 |
| --- | --- |
| Mac（Apple 芯片 M1/M2/M3/M4…） | `Gitube_x.x.x_aarch64.dmg` |
| Mac（Intel 芯片） | `Gitube_x.x.x_x64.dmg` |
| Windows | `Gitube_x.x.x_x64-setup.exe` |
| Linux | `.AppImage` 或 `.deb` |

软件没有经过苹果 / 微软的付费签名，第一次打开会被系统拦一下：

- **Mac**：提示“无法验证开发者”或“已损坏”时，打开「系统设置 → 隐私与安全性」，在下方点「仍要打开」；或者在终端运行 `xattr -cr /Applications/Gitube.app` 后再打开。
- **Windows**：出现“Windows 已保护你的电脑”时，点「更多信息 → 仍要运行」。

## 本地开发

想参与开发？先看 [CONTRIBUTING.md](CONTRIBUTING.md)。

需要 Node.js 20.19 或更高版本（推荐 22 LTS）。

```bash
npm install
npm run dev          # 网页版，打开 http://localhost:5173
```

桌面版开发还需要安装 [Rust](https://www.rust-lang.org/tools/install)（Mac 上还要有 Xcode 命令行工具：`xcode-select --install`）：

```bash
npm run desktop:dev     # 打开桌面窗口，改代码会自动刷新
npm run desktop:build   # 在本机打包安装包，输出在 src-tauri/target/release/bundle/
```

不装 Rust 也没关系，桌面版可以全部交给 GitHub 自动打包（见下一节）。

## 发布

两个自动流程在 `.github/workflows/` 里：

- **网页版**（`pages.yml`）：每次推送到 `main` 分支，自动打包并发布到 GitHub Pages。
  第一次使用前，到仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。
- **桌面版**（`release.yml`）：到仓库 **Actions → 发布桌面软件 → Run workflow**，大约 15 分钟后，Releases 页面会出现各系统的安装包。
  发新版本前，先把 `src-tauri/tauri.conf.json` 里的 `"version"` 改大（比如 `0.1.0` → `0.2.0`），否则会传到同一个版本里。

## 推荐是怎么算的

全部在本地完成，网页版与桌面版共用 `src/lib/recommend.ts`。正常推荐按以下流程运行：

1. **画像**：统计每个 topic / 语言的权重。来源：最近 100 个 Star（越新权重越高）、自己的仓库、兴趣方向（权重最高）、关注者的公开 Star 采样、在本应用里的行为（Star +2.5，收藏 +2，稍后再看 +1，打开 +0.6，有效阅读 +0.3，不感兴趣 −3，30 天半衰期）。
2. **召回**：按权重抽几个 topic（每个 topic 有「经典高星 / 最近活跃 / 一年内新项目」三种搜法），加上「和你 Star 过的某个项目相似」「常用语言的新项目」「本周新星」「换换口味」，合成每轮**一次** GraphQL 请求里的多个搜索。
3. **过滤**：去掉已 Star、本人拥有的仓库、不感兴趣、屏蔽的话题 / 语言、3 天内推荐过的。
4. **排序**：兴趣匹配度 50% + 热度 25% + 活跃度 15% + 一点随机，再打散（同作者、同语言、同来源不扎堆）。
5. 穿插「你关注的人 Star 了」的社交推荐，按关注者权重和 Star 的新鲜度确定优先级。

偏好设置页的「Gitube 眼中的你」会显示当前画像。「关注者的推荐影响」只列出本次取得 Star 样本的账号：当前最多采样 50 位关注用户，每人最近 6 个公开 Star，不能覆盖他们的全部兴趣。贡献按人归一并以 30 天为半衰期衰减，样本多的人不会自动获得更高权重；设为 0 后，原「关注」频道仍照常展示其动态。

「换换口味」按你明确选择且未屏蔽的兴趣 topic，把实际候选分为已选兴趣内外两组，目标约各占 50%；一侧不足时由另一侧补足。没有可用的手选兴趣时，此模式不可用并回到正常推荐。「完全随机」通过随机创建时间窗、Star 区间和排序取得公开项目，再在实际候选池内洗牌，并不代表 GitHub 全库等概率抽样。两种探索模式每批最多 3 轮、每轮最多 8 个搜索条件，不按个人画像或关注者权重排序，不插入定向社交推荐；已有过滤仍生效，Star、收藏、打开和有效阅读等行为也照常累计，供正常推荐使用。

三种模式各有独立的分页进度，共享最近曝光与反馈过滤。在设置页点「重置推荐记录」会恢复正常模式和默认关注者权重，并清空推荐反馈、屏蔽、曝光、有效阅读学习记录及各模式分页进度；收藏夹、稍后再看和历史记录保留。

## 数据存在哪里

- **Star / 取消 Star / 关注作者**：直接写到你的 GitHub 账号。
- **收藏夹、稍后再看、历史记录、推荐反馈、关注者权重、有效阅读学习记录、推荐模式和分页进度**：GitHub 没有对应的公开 API，所以存在本地（浏览器或桌面版的本地存储），按 GitHub 用户名分开。网页版和桌面版各存各的，换浏览器或清除网站数据会丢失。
- **Token**：只存在本地，退出登录会删除。

## 项目结构

```
src/
  api/github.ts        GitHub GraphQL / REST 请求（搜索、Star、README……）
  api/graph.ts         技术图谱的前端采集入口
  lib/graph/           来源证据、技术关系与有界公开数据采集
  lib/recommend.ts     推荐引擎
  lib/channels.ts      首页频道
  lib/interests.ts     兴趣标签 ↔ GitHub topic
  lib/cover.ts         自动生成封面
  lib/actions.ts       收藏、稍后再看、不感兴趣、一键三连
  lib/deviceLogin.ts   桌面版的「使用 GitHub 账号登录」（GitHub 设备码登录）
  store/               状态（zustand）：登录、本地数据、Star 状态、信息流
  components/          卡片、封面、Star 按钮、菜单、收藏夹弹窗……
  pages/               登录、选兴趣、首页、详情、收藏夹、稍后再看、历史、我的 Star、搜索、设置
  styles/              全局样式、README 排版
src-tauri/             桌面版（Tauri）：窗口配置、图标、Rust 入口（代发 GitHub 登录请求）
.github/workflows/     自动发布网页版和桌面版
app-icon.png           图标原图；改了以后运行 npx tauri icon 重新生成各尺寸
vite.config.ts         Vite 配置
```

## 常见问题

- **一直加载 / 提示连不上 GitHub**：需要能访问 `api.github.com`。国内网络不稳定时可以开代理再试。
- **提示接口次数用完**：GitHub GraphQL 每小时 5000 点，正常刷不会用完；设置页能看到剩余额度。
- **Star 失败，提示权限不够**：Token 没勾 `public_repo`。重新生成一个再登录。
- **桌面版「使用 GitHub 账号登录」提示连不上 GitHub**：登录请求会走系统的代理设置，检查网络或代理后再试；也可以先展开「用 Personal Access Token 登录」。
- **头像、封面图显示不出来**：图片来自 `avatars.githubusercontent.com` 等域名，加载失败时会自动换成首字母头像和自动生成的封面。
- **桌面版发布失败，提示 Resource not accessible by integration**：到仓库 Settings → Actions → General → Workflow permissions，选 Read and write permissions。

## 技术来源图谱

项目详情页会分析一层公开来源；导航中的「技术图谱」也可以直接输入 GitHub 仓库地址或 `owner/repo`。选中节点后可查看原文、来源文件行号和判断理由，手动展开下一层，或把节点作为新的根项目。平移、缩放和居中只改变视图，不会重新采集。

图谱由浏览器或桌面版直接读取 GitHub 的公开 README、明确的 GitHub 依赖地址、贡献者、CODEOWNERS 和维护者线索生成。只有明确的上游或下游声明才显示「技术提供者 → 使用者」箭头；普通引用、致谢、人员关联和相似 topics 不等于技术传承。节点大小表达 topics 的交并比，相同语言只作为明确标注的候选线索；图中距离不代表相似度。

每次分析最多 48 个请求、3 个并发、90 秒，验证至多 12 个直接来源，并抽样至多 2 位人员各 30 个公开自有项目。结果可能不完整，界面会显示限制与失败原因。展开由你手动触发，整个工作区上限为 120 个节点、5 层。当前会话最多保留 8 个根工作区，返回时恢复图、选择和视图；退出登录、切换账号或刷新应用后重新开始。重新分析失败会保留已有结果。

不需要自建服务器，不爬取外部网站，不根据依赖包名猜测仓库。方案与实现取舍见 [Issue #3](https://github.com/Andy7016/Gitube/issues/3) 和 [ADR 0004](docs/adr/0004-frontend-provenance-graph.md)。

## 开源协议

[MIT](LICENSE)
