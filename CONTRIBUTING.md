# 参与 Gitube 开发

欢迎一起维护 Gitube！这份文档说明怎么在本地跑起来、怎么提交改动，以及几条需要大家一起遵守的约定。

## 本地开发

需要 **Node.js 20.19 或更高版本**（推荐 22 LTS）。

```bash
git clone https://github.com/Andy7016/Gitube.git
cd Gitube
npm install
npm run dev        # 网页版，打开 http://localhost:5173
```

本地登录用 Token 最简单：登录页有生成 Token 的链接，需要的权限已经帮你勾好了。

桌面版开发是可选的，需要先装 [Rust](https://www.rust-lang.org/tools/install)，Mac 上还要运行 `xcode-select --install`：

```bash
npm run desktop:dev    # 打开桌面窗口，改代码会自动刷新
```

**国内装依赖慢，或者报 `DEPTH_ZERO_SELF_SIGNED_CERT`**：可以临时用镜像安装，`npm install --registry=https://registry.npmmirror.com`。但新增或升级依赖时请用官方源，让 `package-lock.json` 里的下载地址保持一致：

```bash
npm install 包名 --registry=https://registry.npmjs.org
```

## 代码在哪

README 的「项目结构」有完整目录，最常改的是这几处：

| 文件 | 作用 |
| --- | --- |
| `src/api/github.ts` | 推荐、搜索、账号操作与 README 的 GitHub 请求（GraphQL 和 REST） |
| `src/api/graph.ts`、`src/lib/graph/` | 图谱入口、有界 GitHub 采集、来源证据解析与关系语义 |
| `src/lib/recommend.ts` | 推荐引擎：画像 → 召回 → 过滤 → 打分 → 打散 |
| `src/lib/actions.ts` | 收藏、稍后再看、不感兴趣、一键三连 |
| `src/store/` | 状态（zustand）；本地数据存在 localStorage，键名以 `gitube:` 开头 |
| `src/lib/deviceLogin.ts` | 桌面版「使用 GitHub 账号登录」（设备码登录） |
| `src-tauri/` | 桌面版：窗口配置、图标、Rust 代码（只负责代发登录请求） |
| `.github/workflows/` | 自动检查、发布网页版、打包桌面版 |

几条架构上的约定：

- **没有服务器**。所有请求都由浏览器或桌面 App 直接发给 GitHub。不要引入需要服务器或密钥的功能，Client Secret 之类的东西不能出现在代码里。
- **网页版和桌面版共用同一份前端**。只在桌面版生效的逻辑，用 `IS_DESKTOP` 判断。
- **改本地数据结构时要兼容旧数据**。用户的收藏夹、历史等都存在他们自己的浏览器里，可以参考 `src/lib/migrate.ts` 的写法做迁移。

## 提交改动的流程

1. **不要直接推送到 `main`**。从最新的 `main` 拉一个新分支：
   ```bash
   git switch main && git pull
   git switch -c feat/推荐模式切换     # 新功能用 feat/，修 bug 用 fix/，文档用 docs/
   ```
2. **小步提交**。提交信息用一句中文说清楚做了什么，比如「首页返回时恢复滚动位置」。
3. **推送分支，在 GitHub 上开 Pull Request**，按模板填写。
4. **等自动检查通过，再由另一个人看过**，然后用 **Squash and merge** 合并。
5. **合并后删掉这个分支**，本地回到 main：`git switch main && git pull`。

### 一个 PR 只做一件事

- **改动大的功能先开 Issue 讨论**，确认方向再动手
- **不要顺手做无关的改动**：比如格式化整个文件、大面积改名、升级一堆依赖，这些会让 PR 很难审
- **不要删改** `.github/workflows/` 和 `src-tauri/` 的配置，除非这个 PR 就是专门改它们的，并在说明里写清楚原因

### 合并前自查

- `npm run build` 能通过（包含 TypeScript 类型检查）
- 界面改动附上截图，浅色和深色模式都看一下，窄屏下也别挤坏
- 改了 `src-tauri/` 的话，本地用 `npm run desktop:dev` 能启动；没条件测试就在 PR 里说明
- 没有提交 `.env`、Token、Client Secret 等敏感信息

## 发布

- **网页版**：合并到 `main` 后自动发布到 GitHub Pages，不用手动操作。
- **桌面版**：由维护者统一发布，避免版本号冲突。步骤如下：
  1. 开一个 PR 把版本号改大，比如 `0.2.0` → `0.3.0`：
     - `npm version 0.3.0 --no-git-tag-version`：会同时改好 `package.json` 和 `package-lock.json`
     - 手动改 `src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml` 里的 `version`
  2. 合并后，在 **Actions → 发布桌面软件 → Run workflow**，大约 15–20 分钟后 Releases 里会出现新版本。

## 提交身份

git 提交里的名字和邮箱会公开显示在 GitHub 上。不想暴露真实邮箱的话：

1. 在 GitHub 的 **Settings → Emails** 勾选 *Keep my email addresses private*，页面上会显示你的隐私邮箱（形如 `数字+用户名@users.noreply.github.com`）
2. 在本地设置：
   ```bash
   git config --global user.name "你的 GitHub 用户名"
   git config --global user.email "你的隐私邮箱"
   ```
