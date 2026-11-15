# JadeLite（Paper 插件）

让 Paper 服务器回答游戏里 Jade 风格提示条的请求，这样在服务器上对着箱子、木桶、潜影盒、漏斗、投掷器、
发射器、末影箱、熔炉（含高炉、烟熏炉）、酿造台、唱片机时，也能看到里面的东西。消息格式和规则见
`jade/README.md`，与游戏内置服务端（单人、局域网）的 `JadeLiteServer` 一致。

- 成品：`release/jadelite-1.0.0.jar`，放进服务器的 `plugins/`，重启。不需要配置文件。
- 编译：`gradle jar`（Gradle 用 Java 21 运行即可，编译用 Java 25 工具链；Paper 26.2 的开发包要求 Java 25）。
  依赖 `io.papermc.paper:paper-api:26.2.build.135-stable`。
- 规则：12 格以内、区块已加载；上锁的容器不读；还有战利品表的容器只回“内容未知”，不读槽位（读了会生成战利品）；
  每个玩家每 100 毫秒最多处理一次请求。
- Paper 只给客户端登记过的频道发插件消息，而 Eaglercraft 客户端不登记。插件在玩家进服时用反射调用
  `addChannel("jadelite:data")`（Paper 26.2 里是 `PluginMessageBridgeImpl` 的默认方法，客户端发
  `minecraft:register` 时 Paper 自己调用的也是它），对照 Paper `ver/26.2` 分支的源码确认过。反射失败时日志会有
  一条警告，提示条就收不到答复。
- **没有在真正的 Paper 服务器上运行过**：在容器里起 Paper 服务器被权限规则拦下了。只确认了能编译、
  用到的 Paper 接口在 26.2 开发包里都存在、反射的方法名对得上源码。
- 许可：参照 Jade（https://github.com/Snownee/Jade ，CC BY-NC-SA 4.0）的服务端数据提供逻辑，只能非商用。
