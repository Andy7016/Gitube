# Gitube 前端来源

原项目：[Andy7016/Gitube](https://github.com/Andy7016/Gitube)。当前固定版本：[`418daee527607dd0a97b1c8d675bf0a7a4895ecf`](https://github.com/Andy7016/Gitube/commit/418daee527607dd0a97b1c8d675bf0a7a4895ecf)（2026-10-11 拉取的重建版）。原作者 Copyright (c) 2026 Andy7016；完整 MIT 条款保留在 [LICENSE](LICENSE) 和根 [LICENSE](../LICENSE)。

此目录保留原前端的界面、频道、收藏夹、反馈与主题，在其基础上连接本项目同源服务端认证、完整 README 和技术来源图谱。重建前后已跟踪文件逐字节对比：业务源码、依赖文件和配置一致，只有中英文 README 更新及新增截图；因此继续采用已有集成代码，没有把旧 PAT 登录或静态发布方案覆盖回来。

根 Git 仓库直接基于重建版 `origin/main`，本地分支为 `integration/auth-graph`，没有导入重建前的 Git 对象。重建前的本地上游缓存已清理。原仓库的桌面封装源码保留在根 `src-tauri/`，本轮只集成 Web / Node 运行方式，尚未接入桌面安装包。原静态 Pages / 桌面发布工作流不启用；当前应用的会话与追溯服务需要 Node 后端。

集成约定与理由见 [接口约定](../docs/gitube-integration-contract.md) 和 [重建版合并决定](../docs/adr/0007-rebuilt-upstream-history.md)。原 RepoFlow 前端保留在根 `src/`，通过 `npm run build:repoflow` 可恢复构建。
