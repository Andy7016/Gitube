# ADR 0003：无 webhook 注册与账号兴趣画像

日期：2026-10-09。状态：接受。补充 [ADR 0002](0002-youtube-feed-and-github-app.md)。

## 来源与问题

用户实际注册时收到 GitHub「Hook url is not supported … 127.0.0.1」与「Hook is invalid」，并要求登录后参考历史 Star 和本人仓库推荐项目。先前注册配置虽然设置 webhook inactive，GitHub 仍校验其 URL；之前的本地测试只验证表单提交，没有覆盖这个远端约束。

## 决策

RepoFlow 通过 REST API 读取数据，不需要 webhook。注册 manifest 完全省略可选 `hook_attributes`，保持订阅事件为空；不提供虚假的公网 webhook 地址，不要求用户开隧道。回调地址仍指向本机浏览器能访问的站点。回归测试检查每次生成的 manifest 都不含 webhook 配置。

登录后服务端分页读取账号最近最多 1,000 个 Star（包含 starred_at）及最近更新的最多 300 个本人公开仓库。仅分析主题和主要语言等元数据；主题不限于前端原有六种分类。近期 Star 略增权，旧 Star 保持贡献，本人原始仓库权重更高，fork 降权，多主题仓库分摊权重，避免标签数量放大影响。

画像含实际采样数量、上限、截断状态与来自真实仓库的推荐依据。默认推荐用学习主题检索并排序，结合手选偏好；关键词搜索及明确分类保留用户指定范围。推荐页排除已 Star 和本人仓库，收藏与我的 Star 仍可查看。画像不自动覆盖用户手选设置。

画像仅供当前登录会话读取，缓存按账号与 Token 摘要隔离，完整结果十五分钟有效，部分失败一分钟有效。合并同一在途请求；Star 写入、注销失效缓存，失效前的在途结果不得重新写回。一源失败时准确说明部分分析，两个都失败返回错误；401 使本地会话失效。

## 边界

Star 指当前仍保留的 Star 历史，GitHub 不提供已取消 Star 的完整历史。本人仓库使用公开列表，无须扩大授权读取私有源码。页面展示分析范围，超过上限不能称为完整账号历史。真实 GitHub 注册与授权仍需用户本人完成。

## 官方依据

- [Manifest 参数：hook_attributes 为可选配置](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
- [账号 Star 列表：时间戳及分页](https://docs.github.com/en/rest/activity/starring#list-repositories-starred-by-the-authenticated-user)
- [公开用户仓库列表](https://docs.github.com/en/rest/repos/repos#list-repositories-for-a-user)

验收与实际限制记录于 [acceptance.md](../acceptance.md)。

## 2026-10-11 补充：本机登录的真实运行边界

用户实际看到 `GitHub 登录失败：unavailable`。定位发现持久预览被启动在禁止联网的沙盒身份下：静态页面与模拟浏览器回归可用，但隔离会话的无效授权码回调在 0.00 秒内连接失败。换成正常联网身份运行同一服务后，同样的负向请求在约 1.47 秒收到 GitHub 的 HTTP 200 授权拒绝响应。没有更换应用凭据、改代理设置或扩大权限；根因是运行上下文。

原统一异常提示掩盖了失败阶段。OAuth 现分兑换、身份、会话三个安全诊断边界，错误码与固定中文提示对应；日志只记录白名单字段。state 单次消费、PKCE、验证身份后轮换会话及仅服务端保存 Token 的设计保持。会话写入失败显式销毁，防止框架在重定向时再写入认证字段。POST 兑换不重试一次性授权码；真实用户授权成功仍由本人重试确认，不能以模拟测试代替。

用户于同日重试后明确反馈“登录成功”，真实登录流程已由本人确认；结果记录于 [验收](../acceptance.md)。
