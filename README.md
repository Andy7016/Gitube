# Gitube
<img width="4096" height="1846" alt="CleanShot 2026-10-10 at 11 22 35@2x" src="https://github.com/user-attachments/assets/07972e36-2e70-4ccd-9b78-15614c01a357" />

像刷 B 站 / YouTube 一样刷 GitHub 开源项目。用 GitHub 账号登录后，首页按你的兴趣一屏一屏推项目，看到喜欢的可以一键 Star、收藏、稍后再看。

- **网页版**：https://andy7016.github.io/Gitube/ ，打开就能用
- **桌面版**：在 [Releases](https://github.com/Andy7016/Gitube/releases) 下载 Mac / Windows / Linux 安装包

## 功能

- **推荐信息流**：根据你最近 Star 的项目、自己写的仓库、选的兴趣方向，以及你在这里的操作（Star / 收藏 / 打开 / 不感兴趣）推荐项目，每张卡片标出推荐理由（「因为你 Star 了 xxx」「@某人 Star 了」「本周新星」……）。无限滚动，「换一批」刷新。
- **频道**：推荐、关注（你关注的人最近 Star 了什么）、本周新星、本月热门，以及你选的兴趣方向（生物信息、大模型、Rust……）。
- **快捷操作**
  - 卡片右下角的星星：一键 Star / 取消 Star（真的 Star 到你的 GitHub 账号上）
  - 鼠标移到封面上：右上角「稍后再看」「收藏」
  - 「⋮」菜单：收藏到指定收藏夹、复制 `git clone` 命令、不感兴趣、不想看某个话题 / 语言
  - 详情页**长按 Star 一键三连**：Star + 收藏 + 关注作者
  - 详情页快捷键：`S` Star，`B` 收藏到…，`L` 稍后再看
- **详情页**：像视频播放页，左边是项目信息和 README，右边是相关推荐。
- **收藏夹**（可以建多个）、**稍后再看**、**历史记录**、**我的 Star**、**搜索**（支持 GitHub 搜索语法，比如 `topic:bioinformatics stars:>500`）。
- **封面**：项目设置了社交预览图就用那张图；没有的话自动生成一张——底色是主语言的颜色，右上角的格子越亮越密，说明项目最近越活跃。
- 浅色 / 深色主题，手机浏览器也能用。

## 第一次使用：用 Token 登录

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

需要 Node.js 18 或更高版本。

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

## 用 GitHub OAuth 登录（可选，仅本地开发）

想在本地开发时用「使用 GitHub 账号登录」按钮：

1. 打开 https://github.com/settings/applications/new
   - Homepage URL：`http://localhost:5173`
   - Authorization callback URL：`http://localhost:5173/`
2. 创建后复制 Client ID，再点 Generate a new client secret
3. 把 `.env.example` 复制成 `.env`，填上 `VITE_GITHUB_CLIENT_ID` 和 `GITHUB_CLIENT_SECRET`
4. 重新 `npm run dev`

用授权码换 token 必须带 client secret，这一步由 `vite.config.ts` 里挂在开发服务器上的小接口完成，secret 不会打包进前端。网页版和桌面版没有服务器，所以只提供 Token 登录。

## 推荐是怎么算的

全部在本地完成，代码在 `src/lib/recommend.ts`：

1. **画像**：统计每个 topic / 语言的权重。来源：最近 100 个 Star（越新权重越高）、自己的仓库、兴趣方向（权重最高）、在本应用里的行为（Star +2.5，收藏 +2，稍后再看 +1，打开 +0.6，不感兴趣 −3，30 天半衰期）。
2. **召回**：按权重抽几个 topic（每个 topic 有「经典高星 / 最近活跃 / 一年内新项目」三种搜法），加上「和你 Star 过的某个项目相似」「常用语言的新项目」「本周新星」「换换口味」，合成**一次** GraphQL 请求里的多个搜索。
3. **过滤**：去掉已 Star、不感兴趣、屏蔽的话题 / 语言、3 天内推荐过的。
4. **排序**：兴趣匹配度 50% + 热度 25% + 活跃度 15% + 一点随机，再打散（同作者、同语言、同来源不扎堆）。
5. 穿插「你关注的人 Star 了」的社交推荐。

偏好设置页的「Gitube 眼中的你」会显示当前画像。

## 数据存在哪里

- **Star / 取消 Star / 关注作者**：直接写到你的 GitHub 账号。
- **收藏夹、稍后再看、历史记录、推荐反馈**：GitHub 没有对应的公开 API，所以存在本地（浏览器或桌面版的本地存储），按 GitHub 用户名分开。网页版和桌面版各存各的，换浏览器或清除网站数据会丢失。
- **Token**：只存在本地，退出登录会删除。

## 项目结构

```
src/
  api/github.ts        GitHub GraphQL / REST 请求（搜索、Star、README……）
  lib/recommend.ts     推荐引擎
  lib/channels.ts      首页频道
  lib/interests.ts     兴趣标签 ↔ GitHub topic
  lib/cover.ts         自动生成封面
  lib/actions.ts       收藏、稍后再看、不感兴趣、一键三连
  store/               状态（zustand）：登录、本地数据、Star 状态、信息流
  components/          卡片、封面、Star 按钮、菜单、收藏夹弹窗……
  pages/               登录、选兴趣、首页、详情、收藏夹、稍后再看、历史、我的 Star、搜索、设置
  styles/              全局样式、README 排版
src-tauri/             桌面版（Tauri）：窗口配置、图标、Rust 入口
.github/workflows/     自动发布网页版和桌面版
app-icon.png           图标原图；改了以后运行 npx tauri icon 重新生成各尺寸
vite.config.ts         Vite 配置 + 本地开发用的 OAuth 换 token 接口
```

## 常见问题

- **一直加载 / 提示连不上 GitHub**：需要能访问 `api.github.com`。国内网络不稳定时可以开代理再试。
- **提示接口次数用完**：GitHub GraphQL 每小时 5000 点，正常刷不会用完；设置页能看到剩余额度。
- **Star 失败，提示权限不够**：Token 没勾 `public_repo`。重新生成一个再登录。
- **头像、封面图显示不出来**：图片来自 `avatars.githubusercontent.com` 等域名，加载失败时会自动换成首字母头像和自动生成的封面。
- **桌面版发布失败，提示 Resource not accessible by integration**：到仓库 Settings → Actions → General → Workflow permissions，选 Read and write permissions。
