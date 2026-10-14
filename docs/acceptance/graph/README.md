# 技术来源图谱浏览器验收

来源：[ADR 0004](../../adr/0004-frontend-provenance-graph.md)。脚本：[browser-graph-smoke.mjs](../../../tests/browser-graph-smoke.mjs)。

## 方法和复现

Chrome 由 Playwright 启动。脚本只通过 DOM、浏览器导航及公开的 localStorage 账号格式操作应用，不导入应用内部模块。所有 GitHub 请求在浏览器边界替换为独立夹具，不需要真实 Token，也不执行 Star、关注或其他账号写入。

PowerShell，在仓库根目录先启动一个严格端口的开发服务器：

```powershell
npm run dev -- --host 127.0.0.1 --port 5183 --strictPort
```

另一个终端运行：

```powershell
$env:GITUBE_TEST_URL = 'http://127.0.0.1:5183/'
$env:GITUBE_TEST_STAGE = 'local-dev'
$env:GITUBE_PLAYWRIGHT_MODULE = 'C:/Users/17630/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
node tests/browser-graph-smoke.mjs
```

脚本对每次 DOM 等待设置 15 秒上限；故意挂起的两次元数据请求必须在 5 秒内出现，离开页面或退出账号后再释放夹具。运行结束会关闭浏览器并写入 JSON。开发服务器需由启动者停止。

构建产物在部署子路径下的复现命令：

```powershell
npm run build
npm run preview -- --host 127.0.0.1 --port 4183 --strictPort --base /Gitube/
```

另一个终端运行：

```powershell
$env:GITUBE_TEST_URL = 'http://127.0.0.1:4183/Gitube/'
$env:GITUBE_TEST_STAGE = 'local-dist'
node tests/browser-graph-smoke.mjs
$env:GITUBE_SCREENSHOTS = 'docs/acceptance/graph/feed-regression'
node .scratch/preview-validation/production-smoke.mjs
```

Pages 预览可使用同一图谱脚本：改用公开 URL 和独立的 `GITUBE_TEST_STAGE`。若提供完整 40 位 `GITUBE_EXPECTED_SOURCE_SHA`，会检查预览的 `preview-source.json` 后再验收；这会各增加一项 SHA 检查。`GITUBE_SCREENSHOTS` 若仍有值，应先删除该环境变量或指定新的输出目录。

## 当前结果

2026-10-13 最终构建产物在 `http://127.0.0.1:4183/Gitube/` 验收：**图谱 17 项通过，已有浏览流程 10 项通过**，两个命令退出码均为 0。图谱运行时间 10:16:14.737–10:16:20.862 UTC；原浏览回归运行时间 10:16:14.769–10:16:22.057 UTC。

完整记录：[图谱 JSON](local-dist/browser-result.json)、[原浏览流程 JSON](feed-regression/production-browser-result.json)。原浏览回归还确认 JS/CSS 在 `/Gitube/assets/` 下返回 200，且没有依赖源码模块。此前开发服务器的 [16 项通过记录](local-dev/browser-result.json) 保留为中间验收，不包含后来增加的证据限流场景。

主代理整合验证：`npm test` **72/72 通过**，`npm run build` 通过，1810 个模块。最终 JS 为 `index-DTKOcs08.js`，gzip 158.14 KB；CSS 为 `index-DIpCfTDe.css`。

| 行为 | 观察结果 |
| --- | --- |
| 根输入与初始一级采集 | 外站 URL 在本地拒绝；GitHub `.git` URL 正常识别；17 次 REST 得到 9 个节点，只请求根仓库原始 README |
| 证据与方向 | 原文、README 行号链接可打开；上游与下游箭头实际坐标朝向“提供方 → 使用方”；普通引用、人员关联、版权归属与冲突证据没有技术箭头 |
| 键盘与恶意文本 | 节点列表 Home/End 可选中项目；HTML/脚本文字作为文本显示，没有执行，也没有外站请求或凭据外发 |
| 工作区返回 | 图、选择、平移与缩放恢复；返回时 0 次 REST。相机检查允许 0.01 世界坐标及 0.1% 缩放误差，以容纳分数像素尺寸舍入 |
| 手动展开与新根 | 13 次 REST 只增加一个后代；循环与共享节点合并；居中只改变相机，明确设为新根后另开工作区，返回时 0 次 REST |
| 失败与恢复 | 根元数据 503 刷新失败保留 10 个节点；根元数据 200、随后 README 403 限流也保留完整原图；后续成功刷新恢复为新的一级结果 |
| 响应式与嵌入 | 1440px 浅色/深色、390px 深色已截图；窄屏文档宽度等于视口；详情自动分析一级，嵌入区约 648px 高 |
| 原信息流回归 | 随机/换口味往返保留列表与 400px 滚动；详情返回保留底部 1375px 滚动，0 次额外搜索/REST；真实滚轮操作后才继续分页 |
| 取消与账号边界 | 离开图谱和退出账号的两次在途请求均为 `net::ERR_ABORTED`；账号 B 用自己的 Token 重新完成 17 次根采集，没有旧节点泄漏 |

最终图谱流程合计 122 次隔离的 GitHub 请求（107 次 REST、15 次 GraphQL），0 次账号写入、页面异常、应用控制台异常、意外外部请求或凭据外发。Chrome 记录了预期的可选文件 404 与故意失败的 403/503 网络日志；JSON 原样保留这些日志，不将它们描述为应用错误。

最终截图：[浅色](local-dist/graph-light.png)、[深色](local-dist/graph-dark.png)、[390px](local-dist/graph-mobile-390.png)、[失败保留图](local-dist/graph-refresh-failure.png)、[详情嵌入](local-dist/detail-graph-dark.png)。已目视检查图、证据文字和窄屏排版；切换节点/标签页会将证据面板滚回顶部。

原浏览回归另覆盖：关注者权重重载持久化、浅色/深色设置与首页、390px 无横向溢出、三种推荐模式返回顺序/滚动恢复、README 详情返回、底部真实滚轮分页。其截图见 [feed-regression](feed-regression/)。

## 未覆盖项

本浏览器验收没有使用真实 GitHub 账号、OAuth 流程、真实账号写入、原生桌面安装包，也不能推断实时 GitHub 配额或网络稳定性。请求上限、超时、解析反例及 120 节点/5 层限制应结合引擎/工作区单元测试判断。

主代理单独运行的真实 API 只读采集见 [Gitube](live-api.json) 和 [Zustand](live-api-zustand.json)，使用相同前端引擎而非浏览器登录。Zustand 的 5/5 个直接来源验证成功，其中一位开发者仓库读取遇到网络失败，记录明确保留部分覆盖说明；不能据此称全部人员线索覆盖成功。

所有验收浏览器及本次启动的开发/预览服务器均已停止。
