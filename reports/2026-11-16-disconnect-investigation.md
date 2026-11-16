# 掉线排查报告（2026-11-16）

整理自用户电脑上另一个助手的日志分析和本次会话里的实测。为了不泄露隐私，报告里不含 token，也不含玩家的 IP。

## 1. 11-12 到 11-16 的 `Timed out` 汇总（81 次）
- 68 次是单个玩家掉线，同一秒掉 2 人以上的只有 13 次。
- 09:15:51 那次，kleeee 和 Lamalalalalalala 来自同一个学校出口 IP，只掉了 kleeee。
- kleeee 走 Tailscale 直连（不经 Funnel）也掉过 4 次。
- 有监控覆盖的 26 次里，只有 2 次掉线前家里网络有异常，约等于随机基线（4%）。
- Lamalalalalalala 一个人占 31 次；11-14 下午在家里每隔十几分钟掉一次，时间都以 `:51` 秒结尾。
- 结论：多数是玩家自己那头的问题，不是 relay、学校网络、家里网络这条共同的路。

## 2. 关闭码 1000：标签被藏起来（11-16 10:55:23）
用户的面板事件记录里，6 分钟内有 6 次“tab hidden”（65、24、42、121、63、15 秒），连接在 121 秒那次隐藏中间以 code 1000 关闭
（relay 记录：`first=relay idle_before_close=30s reason=target closed`）。浏览器暂停被藏起来的页面，游戏不再调用
`requestAnimationFrame`，答不上服务器的 keep-alive，约 30 秒后服务器判 `Timed out`。
处理：`02f-features.js` 里加了“后台保持运行”（Worker 计时器代替被暂停的帧循环），开关在 Mods 页。

## 3. 关闭码 1006：连接黑洞（11-16 11:08:42，用户在学校，标签一直在前台）
面板显示 `NO DATA`，连接仍是开着的，上传约 116 B/s、下载 0。家里电脑上的助手对时（同一美东时钟）：

| 时间 | 来源 | 内容 |
|---|---|---|
| 11:08:42 | relay | 起，relay 没收到该玩家任何数据 |
| 11:09:12 | Paper | `kleeee lost connection: Timed out` |
| 11:09:42 | relay-closes.log | `code=1006 first=relay alive=724s idle_before_close=60s` |

- relay 到服务器这头是好的：TPS 20.0，relay 心跳无卡顿，家里 CPU 最高 28%、内存最高 66.5%。
- relay 在服务器断开后发了关闭通知，浏览器没有回应，relay 等了 30 秒才强关。真正断线会立刻收到重置，所以这是数据既不通也不报错的黑洞。
- 双向都死（relay 没收到包，浏览器也没收到包），所以是浏览器和 relay 之间的路径，不是服务器。
- 家里网关延迟在 11:05–11:10 有几个超过 100 ms 的点，但都不在 11:08:42 那一刻。
- 分不出是学校网络还是 Funnel/Tailscale：Tailscale 日志在 Windows 上，当时读不到。
- 同一学校出口上，Lamalalalalalala 11:15:42 也掉了一次（`code=1006 first=network-drop`，只活了 27 秒）。

## 4. 连接测试（11-16 11:16–11:17，在学校）
- 能上网、Cloudflare 公共 relay、Heroku 公共 relay、trycloudflare.com 都通。第三方 relay `relay.shhnowisnottheti.me` 不通，与我们无关。
- 游戏随后进服成功；relay-clients.log 里有 11:17:23 来自学校 IP 的连接，说明学校到 Funnel 这一段此刻是通的。
- `tools/connection-test.html` 里自己服务器那一项连不上（1006）：relay 对握手被拒绝（401）的请求不写日志，浏览器看到的也是 1006；
  测试页拼的地址或 token 格式大概率和游戏实际用的不同。**以后以游戏为准，不要用这一项判断服务器通不通。**
- 公网 `https://<funnel 地址>/health` 返回 `{"ok":true,...}`，relay 进程当天 10:26:36 启动、运行正常。

## 5. 还没有答案的问题
- 11:08:42 的黑洞到底出在学校网络还是 Funnel/Tailscale。
- 为此在面板里加了“路径探测”：连接开着时每 5 秒测公网和 relay 主机，`NO DATA` 事件会带上探测结果。还没有在真实掉线里验证过。
- 下次出现时需要：Network 页 Connection events 的截图或 Copy 的文本，以及家里电脑上 Tailscale 日志里同一时间段（日志在 `C:\\ProgramData\\Tailscale\\Logs`）。
