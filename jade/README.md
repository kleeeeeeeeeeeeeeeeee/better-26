# Jade 风格提示条，以及重新编译游戏的方法

`JadeHud.java` 是在游戏源码里加的客户端提示条：准星对着方块或生物时，屏幕上方中间显示名字、图标、
蓝色斜体的 "Minecraft"、作物的 Growth Value、红石线的 Power、生物的血量和护甲。全部在客户端用
`minecraft.hitResult` 算出来，不需要服务器配合（服务器是 Paper，没有装 Jade，真 Jade 的箱子内容、
熔炉进度这类需要服务端的信息拿不到）。

它**不是 Jade 模组本身**，是参照 Jade 源码（https://github.com/Snownee/Jade ）的外观和行为重新写的。
Jade 的许可证是 CC BY-NC-SA 4.0：只能非商用，改编必须用同一许可证，保留署名。`JadeHud.java` 文件头
已写明。不要拿去卖或收费。真 Jade 装不进来：Eaglercraft 没有 Fabric/NeoForge 加载器，TeaVM 也不支持
Jade 用的 Mixin。

## 文件

- `src/` — 新增的 Java 文件，按 `game/src/main/java/net/minecraft/` 下的相对路径放进工作区：
  - `client/gui/JadeHud.java` — 画提示条（名字、图标、模组名、各类行）
  - `client/gui/JadeLiteClient.java` — 向服务器请求方块内部数据，保存最新答复
  - `client/gui/ClientFeatures.java` — 每帧读页面里的开关 `globalThis.__eaglerFeatures`（`@JSBody`）
  - `client/gui/CoordsHud.java` — 坐标显示（精确 XYZ、所在方块、朝向），可放四个角，F3 打开时不画
  - `server/JadeLiteServer.java` — 服务端：收到请求，读方块里的东西，打包回复
  - `network/protocol/common/custom/JadeLite{Request,Data}Payload.java` — 两种自定义消息
- `game.patch` — 对原有文件的改动（用 `git apply` 套进工作区）：把两种消息注册进客户端/服务端的
  自定义消息表、收到消息时转给上面的类、`Hud` 里调用提示条、给熔炉和酿造台加只读取值方法
- `mem.init.gradle` — 放进 `~/.gradle/init.d/`，见下面第 2 条

## 功能现状

只靠客户端（直接读方块状态或实体）：名字、图标、作物 Growth Value、红石线 Power、中继器 Delay、
音符盒 Note、蜂巢 Honey Level、物品展示框里的物品、生物血量和护甲。

要服务端配合（走下面的消息）：箱子/木桶/潜影盒/漏斗/投掷器/发射器里的物品（双箱合并、末影箱显示
看的人自己的）、熔炉进度和三格物品、酿造台、唱片机。尚未实现：蜂巢里的蜜蜂、刷怪笼冷却、讲台、
生物成长/繁殖、村民补货、状态效果、宠物主人。

**状态（2026-11-15）：这一批代码只通过了 Java 编译，没有重编 Wasm，没有在浏览器里跑过。** 所以画面
（物品格、进度条的位置和尺寸）、请求/回复是否真的走通，都没有验证过。单人和局域网的服务端在游戏源码里，
所以只要重编就有；用户的 Paper 服务器需要另写一个插件（见下），在那之前这些行不会出现（客户端发 3 次
没收到答复就不再问，重新进入世界会重置）。

## 消息格式（给 Paper 插件用）

两个频道，插件消息频道名就是下面的 id；数据用 Minecraft 的 `FriendlyByteBuf` 写法（VarInt、UTF 字符串
= VarInt 长度加 UTF-8 字节、long 大端）。

- `jadelite:req`（客户端→服务器）：`byte kind`（0=方块）、`long pos`（`BlockPos.asLong()`）、
  `VarInt entityId`（方块时不用）。客户端对着有方块实体的方块时，换目标立刻发，之后每秒一次。
- `jadelite:data`（服务器→客户端）：`byte kind`、`long pos`、`VarInt entityId`、`VarInt 长度 + 字节` 的
  body（最大 16384）。body 是若干段，每段先一个 `byte type`：
  - `1` ITEMS：`VarInt n`，n 个（utf 物品 id，VarInt 数量），客户端按种类合并显示，最多 54 种
  - `2` FURNACE：`VarInt lit`、`VarInt cook`、`VarInt cookTotal`，再 3 个（utf id 或空串，VarInt 数量）
  - `3` BREWING：`VarInt brewTime`、`VarInt fuel`，再 5 个（utf id 或空串，VarInt 数量；槽 0–2 是瓶子，
    3 是材料，4 是燃料）
  - `4` JUKEBOX：utf 唱片物品 id，或空串
  - `5` LOOT：没有内容，表示这个容器还有没打开的战利品表，不能读（读槽位会触发生成战利品）
  物品 id 是普通注册名，如 `minecraft:diamond`，所以插件用 Bukkit 的 `Material` 就能写，不用碰游戏的
  物品编码。没有内容也要回一个空 body，这样客户端知道服务器支持。
- 服务端的规则（`JadeLiteServer`）：距离 12 格以内、区块已加载；上锁的容器对打不开的玩家不回；还有
  战利品表的容器不读。插件照这个做。

## 重新编译

工作区：`https://github.com/kingjoeishere/Eaglercraft-26.2-u2-workspace`，用的提交是
`f0dafd1e3c1fb39006735ffc0bc6fd879fa98de3`。克隆到仓库目录之外（约 330MB）。

2026-11-15 在 15GB 内存、4 核的容器里实测可行，**全部重编约 50 分钟**（客户端链接约 28 分钟，网格约 1
分钟，服务端约 15 分钟，打包几分钟）。依次踩到的坑：

1. **Gradle 要用 Java 25 运行**，PATH 里的 Java 21 会报 `class file version 68.0`。Gradle 第一次会自己下载
   Java 25 到 `~/.gradle/jdks/`，把 `JAVA_HOME` 和 `PATH` 指过去。链接步骤也是用 PATH 里的 `java`，要
   Java 25（否则 `Unrecognized VM option UseCompactObjectHeaders`）。
2. **javac 子进程默认只有 512MB 堆**，编 `:game` 时 `OutOfMemoryError`，改 `gradle.properties` 没用。
   用 `mem.init.gradle`（放进 `~/.gradle/init.d/`）把它调到 10g。
3. **链接堆默认 12288MB 超过脚本允许的上限**（上限 = 13312 − 2048）。设置环境变量
   `EAGLER_LINK_HEAP_MIB=11264` 和 `EAGLER_SERVER_LINK_HEAP_MIB=11264`。
4. 打包要 `npm install`（只有一个依赖 `brotli-dec-wasm`），可加 `--ignore-scripts`。
5. 缺 `sounds.epk`（官方做法要 FFmpeg 从 Mojang 下载音效）：直接用本仓库 `payloads/sounds.epk` 复制到
   `target_teavm_wasm_gc/build/web/sounds.epk`。缺 `music.epk`：放一个空文件到
   `target_teavm/build/web/music.epk`。最后导出可选音乐包会报错，但 HTML 在那之前已写好，可以忽略。
6. 被杀后留下的 `wasm-toolchain/generated/standalone-link-cache/operation.lock` 要手动删（先确认没有编译
   进程）。
7. **编译期间容器必须一直有任务在跑**。启动编译后如果直接结束回复，容器会被回收重启，编译被杀（实测
   两次）。要同时挂一个等待编译结束的后台命令。
8. 链接时内存峰值约 11.4–11.9GB，所以 16GB 的 Windows 电脑跑不了；脚本还依赖 `/proc` 和 bash。

编完用：

    JAVA_HOME=<java25> PATH=<java25>/bin:$PATH EAGLER_LINK_HEAP_MIB=11264 EAGLER_SERVER_LINK_HEAP_MIB=11264 \
      node wasm-toolchain/build-single-html.js --output <输出>.html

## 把新游戏换进本仓库

工作区产出的 HTML 页面结构和本仓库的一致，所以不用整个替换：用 `tools/split.py` 的临时副本（脚本名列表
只留原版的 6 个）分别拆原版和新版，把原版→新版的差异套到本仓库：换掉 `src/js/` 里原版的 6 个脚本（
01–06，我们加的 02b–02e 不动）、`payloads/` 里的 `client.wasm.br`、`mesh.wasm.br`、`server.wasm.br`、
`assets.epk`，再把模板里不同的行（`data-size` 和 `<title>`）同步过去。`decoder.wasm`、`sounds.epk` 没变。
