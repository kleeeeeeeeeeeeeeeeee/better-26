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

## 4b. 新版 html 抓到的现场（11-16 12:06，用户在学校）
面板事件记录（UTC，美东 = UTC-5）：

```
17:06:35 stall 15 s   internet ok, relay host FAIL
17:06:35 probe 15 s   home relay host
17:06:50 drop  15 s   internet ok, relay host FAIL
```

- 公网探测通，去家里 relay 主机（Funnel 地址）的探测同时失败：学校网络本身没断，只有去家里这一路不通。
- 家里电脑上助手的对时（美东）：同一时间三个玩家（kleeee、Lamalalalalalala、Noonecare1234999，来自两个学校 IP）一起断流。
  Paper 12:07:05 同一秒判三人 `keepalive timeout`；relay 12:07:35 同一秒强关三条连接（Paper 超时后又等了 30 秒的关闭确认，没等到）。
  12:06:26 还有 kleeee 的传送指令到达服务器，所以断流大约从 12:06:20 到 12:06:35 之间开始。
- 页面在 12:06:50 自动关了连接（`drop`），但 relay 直到 12:07:35 才看到关闭：黑洞一直持续到那时。
- 家里电脑、relay、Paper 在 12:06:20–12:06:50 没有卡顿：TPS 正常，relay 心跳无记录，CPU 最高 20%，DNS 全部正常，
  到网关、1.1.1.1、8.8.8.8 的 ping 没有超时（偶有 42–50 ms 的跳动）。
- **家里电脑的 Wi-Fi 信号在 12:06:01–12:06:36 从 86% 掉到 63–75%，12:06:39 回到 85%；当时连的是 6GHz。**
  11:08 那次附近（11:05–11:10）网关延迟也有 107–213 ms 的跳动。
- 12:04:56 服务器被重启过：11-16 12:05:05、12:05:34 的 `stall`，以及 12:05:17–12:05:22 的 1005 和 1000 关闭是这次重启造成的，与网络无关。
- relay 日志只记 `/minecraft` 的 WebSocket 连接，不记对根路径的 HTTPS 请求，所以探测请求有没有到 relay 无法从日志证明。

判断：三人同时断、公网正常、只有去家里这一路不通，指向**家里这头或 Funnel 一侧**，学校整体网络的嫌疑下降。
推测（未证实）：家里电脑 Wi-Fi 抖动时，Tailscale 到 Funnel 入口的通道需要重新协商，期间外面的连接进入黑洞。
验证：把家里电脑改成有线（或 5GHz）并关闭网卡的省电关闭选项，玩一两天看掉线是否明显减少；同时读 Tailscale 日志里
12:06:20–12:06:50 有没有路径变化或重连。

## 5. 还没有答案的问题
- 黑洞出在 Funnel/Tailscale、家里 Wi-Fi，还是学校到 Funnel 的路径（见 4b，目前倾向家里这头，未证实）。
- 面板里的“路径探测”和 15 秒自动断开已在 12:06 那次真实掉线里工作（4b）；游戏收到合成的关闭后是否显示断开界面还没确认。
- 下次出现时需要：Network 页 Connection events 的截图或 Copy 的文本，以及家里电脑上 Tailscale 日志里同一时间段（日志在 `C:\\ProgramData\\Tailscale\\Logs`）。
