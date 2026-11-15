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

- `JadeHud.java` — 放进工作区的 `game/src/main/java/net/minecraft/client/gui/`
- `Hud.java.patch` — 在 `Hud.extractRenderState` 里加一行调用
- `mem.init.gradle` — 放进 `~/.gradle/init.d/`，见下面第 2 条

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
