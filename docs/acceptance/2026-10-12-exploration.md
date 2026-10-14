# 探索与恢复验收（2026-10-12）

设计：[ADR 0003](../adr/0003-exploration-and-feed-resume.md)。前置：[关注者权重](2026-10-12-following-weights.md)、[前台阅读](2026-10-12-foreground-reading.md)。图谱仅提交 [Issue #3 方案](https://github.com/Andy7016/Gitube/issues/3)。

## 自动化与构建

`npm test` **40/40**，无失败或跳过；`npm run build` **通过**。全部使用现有 TypeScript 和 Node test runner，没有新增依赖。

覆盖实际候选 topic 分类与 9/9 目标、短缺补足、随机模式不受画像/阅读/关注权重排序影响、共同过滤、旧 normal 游标兼容、模式及账号隔离、失败事务回滚、慢模式/换批/重置请求、seed promise 竞态、Star 晚结果、即时缓存过滤与撤销、哨兵门控。

## 浏览器

Chrome，1440×1000 和 390×844；所有 GitHub API 均由 `tests/browser-smoke.mjs` 的隔离样本响应，没有真实 Token 或远程账号写入。8 项检查通过，无页面脚本异常：

1. 关注者滑杆键盘调整与账号内持久化。
2. 设置浅色与深色截图。
3. 设置 390px 窄屏无横向溢出。
4. 模式往返保留仓库顺序及滚动，不重复检索。
5. 首页浅色、深色和 390px 布局。
6. 详情返回恢复已有列表，不重复推荐检索。
7. 恢复到底部时哨兵保持暂停，真实滚轮后继续分页。
8. 挂载详情 hook：60 秒外跳不触发，前台再超过阈值记录一次；继续阅读不重复计权。

修复了切模式时新列表高度夹断旧滚动值的问题；频道栏只横向滚动，避免干扰页面恢复。慢响应还由 store 与引擎两个有效性检查保护。

截图：[首页浅色](images/exploration-home-light.png)、[首页深色](images/exploration-home-dark.png)、[首页窄屏](images/exploration-home-mobile.png)、[设置浅色](images/exploration-settings-light.png)、[设置深色](images/exploration-settings-dark.png)、[设置窄屏](images/exploration-settings-mobile.png)。[机器可读检查](images/exploration-browser-result.json)。

可选复现：使用已安装的 Playwright，设置 `GITUBE_PLAYWRIGHT_MODULE` 为其 `index.mjs` 绝对路径（或本地可解析的 `playwright`），启动一份干净的 `npm run dev`，再执行 `node tests/browser-smoke.mjs`。`GITUBE_TEST_URL` 可指定测试服务器地址；不要在浏览器验收期间热更新源码，以免动态导入出现不同版本的 store。该脚本不属于默认 `npm test`。

## 未覆盖

没有重新验证真实 GitHub 登录、Star 权限或 API 网络表现；没有启动 Tauri 或打包安装器。共享前端构建通过，`.github/workflows/`、`src-tauri/`、认证路径和依赖未改。三个实现阶段按依赖顺序审阅；图谱等待 Issue 方案讨论，不含运行时代码。
