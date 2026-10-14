# 关注者权重验收（2026-10-12）

设计：[ADR 0001](../adr/0001-following-weights.md)。基线：`2853422a85ca4c9b474faac1812f3ac99b2aa638`。

- 从基线装配仅含关注者权重的独立源码副本：`npm test` **7/7**，无失败或跳过；`npm run build` **通过**（TypeScript + Vite，1796 modules）。
- 覆盖按人归一、权重线性、0 倍、去重、30 天衰减、社交优先级、旧 version 1 收藏和账号切换防抖隔离。
- Chrome 隔离模拟：3 位关注用户的真实接口形状样本，滑杆键盘修改 1.5 → 1.75 倍并写回本账号 localStorage；浅色、深色和 390px 窄屏检查通过，无页面脚本异常和横向溢出。
- 截图为测试样本，不使用真实 GitHub Token 或账号数据：[浅色](images/following-settings-light.png)、[深色](images/following-settings-dark.png)、[窄屏](images/following-settings-mobile.png)。

未测试真实 GitHub 网络、权限及桌面容器；没有修改 GitHub API、登录、发布工作流或 Tauri 配置。生产构建复用现有静态入口，无新增依赖或服务器。
