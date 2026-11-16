# better-26

Eaglercraft 26.2 单文件 HTML 的拆分版本。原始文件约 75.6MB，其中 99.8% 是内嵌的
base64 数据块；为了便于阅读和修改代码，仓库里保存的是拆分后的文件，单文件 HTML
由脚本重新生成。

## 目录结构

- `src/index.template.html` — HTML 骨架，被拆出去的内容在原位置换成占位符
- `src/js/` — 9 段内联脚本，按在页面中出现的顺序编号
  - `01-brotli-decoder.js` — Brotli 解码器（已压缩，不可读）
  - `02-inline-payload-loader.js` — 内联数据块的加载与 fetch 拦截
  - `02b-m1-air-profile.js` — 渲染分辨率控制，以及 MacBook Air M1 和 Intel 核显笔电两套性能配置（后加的）
  - `02c-perf-panel.js` — 屏幕左上角的性能面板（后加的）
  - `02d-home-server.js` — 自建服务器预设（后加的，见下文）
  - `02e-mac-shortcuts.js` — Mac 上把 Command+A/C/V/X 转成 Control 版本（后加的）
  - `02f-features.js` — 游戏内置功能的开关（Jade 提示条、坐标显示），状态存在 localStorage，游戏每帧读取（后加的）
  - `02g-coords-overlay.js` — 坐标显示，由页面根据游戏每帧递来的 `window.__eaglerGame` 画（后加的）
  - `03-debug-flags.js` — URL 调试参数与诊断开关
  - `04-teavm-wasmgc-runtime.js` — TeaVM Wasm-GC 运行时（已压缩）
  - `05-worker-bootstrap.js` — 页面与 worker 共用的 Wasm-GC 启动逻辑
  - `06-main.js` — 主入口（`type="module"`）
- `src/css/style.css` — 加载界面、横屏提示等样式
- `src/css/panel-ui.css` — 性能面板用的物品小图标（后加的）。用 `@@EAG:b64:...@@` 内嵌 `src/img/icons/` 里的
  图片；`build.py` 会展开插入的 `.css` 文件里的占位符（只对 `.css`）
- `src/img/icons/` — 游戏自带的 16×16 物品贴图：红石粉（菜单按钮）、时钟、望远镜、末影珍珠、附魔书（标签页）
- `payloads/` — 6 个二进制数据块（原文件中是 base64）
  - `decoder.wasm` — Brotli 解码器的 WASM
  - `client.wasm.br` / `mesh.wasm.br` / `server.wasm.br` — Brotli 压缩的游戏 WASM
  - `assets.epk` / `sounds.epk` — 资源包与音效包（EAGPKG 格式）
- `tools/split.py` — 原始 HTML → 上述文件
- `tools/build.py` — 上述文件 → 单文件 HTML
- `tools/original.sha256` — 原始 HTML 的 SHA-256
- `tools/epk_to_vanilla.py` — 把游戏导出的世界 EPK（`epk/world262`）转成原版世界文件夹，
  可直接作为 26.2 Java 服务端的 `world`。游戏里的 “Convert to Vanilla” 按钮在源码里是
  写死禁用的，所以用这个脚本代替。用用户的真实存档跑过：6623 个地形区块的坐标和
  `DataVersion`（4903，即 26.2）全部核对一致；还没在真正的 26.2 服务端上加载过
- `tools/encrypt-token.html` — 独立页面，本地用密码加密 relay token，见“自建服务器预设”
- `tools/panel_preview.py` — 生成 `dist/panel-preview.html`（约 50KB，只有面板没有游戏），改面板外观后用它看效果或发给用户
- `tools/connection-test.html` — 独立的连接测试页，在目标网络下用浏览器打开，检查能否连到
  内置 relay、trycloudflare.com 以及用户自己的服务器地址
- `dist/` — 构建输出，已加入 `.gitignore`

## 重新生成 HTML

运行 `python3 tools/build.py`：读模板，把每个占位符换回对应文件内容（二进制重新
编码为 base64，按原文件的每行 262144 字符换行），输出到
`dist/eaglercraft-26.2.html`。

脚本最后会比对 SHA-256，确认拼回来的文件和原文件逐字节相同。如果某个数据块重新
编码后对不上，就把那一块改为保留原始 base64 文本。

占位符格式：

- `@@EAG:file:<路径>@@` — 原样插入文件内容
- `@@EAG:b64:<路径>:<行宽>@@` — 把文件编码为 base64 后插入，行宽 0 表示不换行

## 注意事项

- `src/` 和 `payloads/` 里的文件必须逐字节保持原样（包括首尾空行），`.gitattributes`
  已关闭换行符转换。未做修改时，`build.py` 必须输出 `OK: byte-identical`。
- 有意修改了代码之后，`build.py` 会报告与原文件不同并返回 1，这是预期行为。
- 游戏逻辑在 `client.wasm.br` 里（Java 经 TeaVM 编译成 WASM），这里读不到也改不了；
  能改的是加载、启动、界面这一层的 JS 和 CSS。
- 要拆分新版本的 HTML：`python3 tools/split.py <新文件.html>`，它会覆盖 `src/`、
  `payloads/` 和 `tools/original.sha256`。

## MacBook Air M1 性能配置

`src/js/02b-m1-air-profile.js` 在游戏启动前检测 M1 Air（Mac + GPU 名称为 Apple M1；
Safari 隐藏 GPU 名称时改用 8 核 + 13.3 寸屏幕分辨率判断），命中后做两件事：

- 把 `window.devicePixelRatio` 封顶为 1.5：画布像素数降到原来的约 56%
  （全屏 2880×1800 → 2160×1350）
- 把 `navigator.hardwareConcurrency` 报告为 4：mesh worker 上限从 4 降到 2
  （上限 = 核心数 − 2），启动数量仍由游戏自适应

URL 参数：`?m1=1` 强制开启，`?m1=0` 关闭，`?renderscale=N` 调整分辨率上限
（0.5–3，M1 Air 默认 1.5）。状态见 `window.__eaglerM1Profile`；在 Mac 上启动时屏幕顶部还会
显示约 10 秒的状态横幅（用户打不开 F12，靠它确认是否生效）。

用户在真实 M1 Air 上的实测（屏幕缩放为 1661×933，Native 是 3322×1866）：1x 和 1.5x
帧率几乎没区别，Native 波动很大。所以默认值定为 1.5；说明 1.5x 以下瓶颈不在 GPU
像素填充。mesh worker 上限也让用户对比过（加入同一个 LAN world，
上限 4 对上限 2，清晰度都是 1.5x）：两者都在 2–3 秒内回到 60 帧，没有明显差别；上限 4
开头掉到过 30 以下，上限 2 最低 30。所以保持上限 2。由于加了这个文件，`build.py` 现在会报告与原文件不同，属于预期。

## Intel 核显笔电配置（用户的 MSI）

用户家里跑服务器的那台 Windows 笔电：i5-13420H（4 性能核 + 4 能效核，12 线程）、16GB 内存、
1920×1080、缩放 100%。另一个助手用 Claude 自带浏览器读到显卡是 Intel UHD Graphics，但用户
的 Chrome 实际用哪块显卡没确认；这个型号的笔电常见还带 NVIDIA 独显，Chrome 可能只是被
Windows 的“图形设置”分到了核显。

`02b` 里的 `detectPC()`：Windows + `hardwareConcurrency === 12` + WebGL 报告的 GPU 名含
Intel UHD/Iris/HD/Xe 时命中（浏览器读不到 CPU 型号，所以只能这样判断）。命中后：

- 渲染分辨率上限默认 1（这台机器缩放 100% 时没有变化，但以后调了 Windows 缩放也不会让
  像素数跟着涨）
- 把 `navigator.hardwareConcurrency` 报告为 4，mesh worker 上限 2（这台机器同时跑着 Paper
  服务端、relay、隧道，少占一点 CPU；这是推断，没有对比测过）
- 面板的 Auto 清晰度默认开（没有保存过选择时）
  （Auto 的下限：屏幕缩放比为 1 时是 0.75，高密度屏是 1。用户在 1080p 100% 的屏幕上实测
  命中配置后画面显示 `now 1x`，原来下限是 1，Auto 在这种屏幕上什么都做不了，所以改了）
- 带面板的版本启动时顶部显示 18 秒的横幅，写明用的是哪块 GPU，并提示“如果这台笔电还有
  NVIDIA 独显，去 Windows 设置 → 系统 → 屏幕 → 图形里把 Chrome 设成高性能，重启 Chrome”

探测显卡用的 WebGL 上下文和游戏一样请求 `powerPreference: "high-performance"`（游戏的上下文
就是这么建的），这样双显卡笔电上报告的是游戏实际会用的那块。用户 2026-11-14 确认任务管理器
里有 GPU 0 和 GPU 1，已经把 Chrome 加进 Windows 图形设置，但面板仍显示 Intel UHD，原因待查
（Chrome 没有完全退出重开、设置不是“高性能”，或加错了 chrome.exe）。

`?pc=1` 强制开，`?pc=0` 关。Chrome 用独显时 GPU 名不含 Intel，不会命中，也就没有这套限制。
面板新增 GPU 一行（整合显卡标黄、悬停有提示）和“Profile”一行（Intel PC / M1 Air / off），
Record log 的头部写着设备配置和 GPU。**所有数字都没在这台真机上测过**，等用户在 Windows
上用 Record log 录一段（可分别试 `?pc=0` 和默认）再调。

## 性能面板

**2026-11-15 定稿的界面（第三版）**：用户试了一版完全 Minecraft 化的面板（原版按钮/标签/滑块贴图、Monocraft 像素
字体、提示框底色），觉得不如第一版好看，要求退回第一版再重新设计，“酷、符合他的风格，但要和 MC 搭”。现在是：
第一版的深色半透明卡片和普通字体，圆角收小（卡片 6px、按钮 3px），开关滑块和小节标题用 MC 绿 `#5BD45B`，警告用
MC 的黄 `#FFFF55`、红 `#FF5555`，开关的圆钮改成小方块；标签页 Stats、Video、Network、Mods 前面各有一个游戏物品
图标（时钟、望远镜、末影珍珠、附魔书）。**左上角的菜单按钮是一个圆形，里面是红石粉图标，不显示帧率**：用户反映
游戏自带的帧率和面板的帧率同时出现、数值总有偏差（游戏数“一整秒画了多少帧”、每秒更新；面板用
requestAnimationFrame 间隔估、每半秒更新）。连接没数据或正在录日志时，按钮变成胶囊形，图标旁加红字。面板内部仍用
自己的测量（帧时间曲线、Auto）。用 `tools/panel_preview.py` 生成的预览页在无头浏览器里截图核对过外观；没在真机上看过。
不要再改回像素字体和原版贴图那一版。

之前的版本（同日）：深色圆角卡片，四个标签页——Stats（帧时间曲线、GPU、区块网格、电量、游玩时长）、
Display（清晰度滑块和 Auto）、Network（流量和连接）、Features（开关）；底部固定 Fullscreen 和 Record log。
当前标签记在 localStorage `eaglercraft26.perfPanel.tab`。数据逻辑（测量、Auto、录日志）没有改，只换了界面结构。
**只在 Node 里用假的 DOM 把构建流程和所有点击处理跑过，没有在真实浏览器里看过外观**，位置、间距、字体可能还要调。

**Features 标签**：开关 Jade 提示条、坐标显示，选坐标显示在哪个角（左上、右上、左下、右下）。状态在
`window.__eaglerFeatures`（`jade`、`coords`、`coordsPos`），由 `02f-features.js` 创建，所有构建都带（包括没有面板的
朋友版，那时全部默认开）。游戏源码里 `ClientFeatures`（`@JSBody`）每帧读它，所以**开关要游戏本体是新编译的版本才有
效果**；旧游戏不认这个对象，开关不起作用。坐标显示后来改由页面画，见下文“游戏把状态递给页面”。
这两个类的源码在 `jade/src/client/gui/`。

`src/js/02c-perf-panel.js`。左上角的帧率小标签可以拖动，点击展开面板（界面是英文）：

- 帧时间曲线：最近 30 秒，每半秒一根柱子，高度是这半秒里最慢的一帧，横线是 60 帧
- 最差帧时间、游戏帧时间（进入世界后）、画布分辨率、M1 配置状态
- Chunk meshing：区块网格管线的计数（worker 数、排队的区块段和结果、进行中的任务、
  已完成数、内联完成数、错误/取消/收缩次数），数据来自游戏每帧写的
  `window.__meshWorkerPool`。用来排查“地形有碰撞但看不见”的问题
- 渲染分辨率滑块（0.5x 到屏幕原生，步进 0.25）和 Auto 按钮
- 网络：游戏自己的 WebSocket 和 WebRTC 数据通道的上下行速度、累计流量、当前连接的
  主机和建立连接用时
- 电量（仅 Chrome）、游玩时长、全屏按钮
- 连接无数据警告：游戏的 WebSocket / 数据通道连着，但超过 5 秒没有收到任何数据时，标签
  变红并显示 `NO DATA 12s`，Network 的 Connection 一行也会标 `silent`，录制的日志里有
  `silentS` 一列。在线的服务器每秒至少发一个时间同步包，所以持续沉默说明连接卡死
- Record log：录 60 秒（再点一次提前结束），结束后自动下载
  `eaglercraft-log-<时间>.txt`，内容是每半秒一行的采样（帧率、网格管线计数、网速等）、
  录制首尾的 `__meshWorkerPool` 完整快照，以及这段时间里游戏写进 `window.__log` 的日志。
  用户打不开 F12，排查问题时让用户录一段发过来

实现要点：

- 滑块的值是玩家选的清晰度上限，存在 localStorage 的 `eaglercraft26.renderScale`。
  Auto 在 1x 和这个上限之间自动调整，调用 `__eaglerRenderScale.set(值, true)`，
  第二个参数表示临时调整、不覆盖玩家的选择。
- Auto 的规则（`createAuto`）：帧率连续约 1 秒低于刷新率的 80% 就降 0.25；连续约 8 秒
  不低于 95% 才升 0.25；每次调整后冷却 2 秒；刚升上去又被迫降下来时，下次升之前的
  等待时间翻倍（最长 2 分钟），避免来回跳。只在 `__eaglerGameReady` 之后运行。
- 网络计数靠 `class extends` 包了一层 `WebSocket` 和 `RTCPeerConnection`，并改了
  `RTCDataChannel.prototype.send`。worker 里的连接统计不到。连接是否存活看
  `readyState`，不等 close 事件。
- 帧率是用 `requestAnimationFrame` 的回调间隔估的，不是游戏内部的计数。
- 页面的 `<meta charset>` 在 75MB 之后才出现，新增的 JS 只用 ASCII 字符，界面文字用英文。
- 游戏全屏的是 `#game_frame`，面板在全屏时会被移进去，否则看不到。
- 按钮用 `<div>` 而不是 `<button>`，滑块 `tabIndex=-1` 且用完立刻 `blur()`，避免获得键盘
  焦点后被游戏里的按键触发。
- `?panel=0` 关闭面板和网络计数。内部状态在 `window.__eaglerPerfPanel`。
- 自动调节在真实 M1 上还没实测过，只测过控制逻辑和在无头浏览器里的降档。

## Mac 上 Command+A/C/V/X 不起作用

用户在 Mac 上全选、复制、粘贴都没反应，Windows 上正常。用无头 Chromium 伪装成 Mac 对比
了原版 HTML 和我们的构建：两者一样，Command+A 不起作用，Control+A 起作用，所以不是
面板或其他改动造成的。原因是游戏用 `System.getProperty("os.name")` 判断是不是 macOS
（`InputQuirks.REPLACE_CTRL_KEY_WITH_CMD_KEY`），这个构建里它没有判成 Mac，于是快捷键
一直是 Control。`02e-mac-shortcuts.js` 在 Mac 上截获 Command+A/C/V/X，改成 Control 版本
的 keydown 加 keyup 再交给游戏（macOS 按住 Command 时浏览器不发字母键的 keyup，所以补
一个），并沿用游戏对 Control 版本的 `preventDefault` 结果，避免浏览器自己再粘贴一次。
伪装 Mac 的无头测试里全选、复制、粘贴都通过；用户在真 Mac 上确认可用（2026-11-13）。粘贴要读系统剪贴板，Chrome
第一次会弹出“要查看剪贴板”的权限提示，拒绝的话游戏会退回成弹一个输入框让用户手动粘贴。
所有构建（包括 `"panel": false` 的）都带这个脚本。

## Jade 风格提示条与新版游戏（2026-11-15）

游戏已经换成用工作区源码重新编译的新版（构建号 `1e2017e0712b3280`，原来是 `21b0a73c5a7f5526`；
新版多了一个资源下载的 XHR 修复），并且在客户端里加了 Jade 风格的提示条：准星对着方块或生物时，
屏幕上方显示名字、图标、模组名、作物生长、红石强度、生物血量。源码、补丁、完整的重编步骤和踩过的坑
都在 `jade/`，**改游戏逻辑就是走这条路**（改 Java 源码、重编 Wasm），约 50 分钟。

- 在无头浏览器里完整验证过：新建世界进入后，对着树叶显示 "Oak Leaves / Minecraft"，面板和
  服务器预设同时正常。**没有在真机上看过，也没有测过作物、红石、生物血量这几项**（编译通过，但没有
  实际画面）。
- 这不是真 Jade，是参照 Jade 源码重写的，只能非商用（CC BY-NC-SA 4.0）。真 Jade 装不进 Eaglercraft。
- **之后又加了一批（只编译通过，没有重编、没有跑过）**：箱子等容器里的物品、熔炉进度、酿造台、唱片机
  （要服务端答复，自定义消息 `jadelite:req` / `jadelite:data`），以及音符盒、中继器、蜂巢蜜量、物品展示框
  （纯客户端）。单人和局域网重编后就有；用户的 Paper 服务器要另写插件，消息格式和规则见 `jade/README.md`。
  一个提醒：我曾说“单人不需要插件，因为内置服务端在浏览器里”，这不对——它跑在独立的 worker 里，客户端读不到，
  所以也要发消息；只是服务端代码是我们自己编的，不用插件。
- **最终版已编好并换进仓库（构建 `ea652f93b1b49f33`）**：含容器内容、熔炉、酿造台、唱片机、开关、坐标显示。
  只做了启动检查（home、friends 都在 15 秒内就绪、无页面错误、开关对象存在），提示条和坐标的画面、新面板外观都
  还没在浏览器里看过。
- 用户说过：这类重编不要在容器里自己跑，要他同意；他的 MSI 只有 16GB，链接峰值要 11.4–11.9GB，
  又依赖 Linux 的 `/proc` 和 bash，实际跑不了。要重编先和用户商量在哪跑。
- 现有 `local/` 目录被清空过一次，已从上次的构建里恢复 `local/home-server.json`（不含 `panel`）。
- 打包时 `eaglercraft-26.2.html`（无 token 的普通版）要在 `local/home-server.json` 不存在时构建，否则
  会把 token 嵌进去。

## 游戏把状态递给页面（`window.__eaglerGame`）

为了少重编，2026-11-15 起游戏每帧把一份状态交给页面，由页面的 JS 画叠加层；以后改这些叠加层的样子和规则只改 JS。
游戏里的 `GameStateBridge`（`jade/src/client/gui/`，在 `Gui.extractRenderState` 开头调用）写入：`inWorld`、`x/y/z`、
`bx/by/bz`（方块）、`yaw`、`pitch`、`fps`（游戏自己的计数，就是它屏幕上显示的数）、`guiScale`、`screen`（0 无、1 聊天、
2 暂停菜单、3 其他界面）、`debug`（F3）、`hudHidden`（F1）、`time`、`biome`、`dimension`（这两个只在变化时写）、`t`
（`performance.now()`）。超过 1 秒没更新就当游戏没在发（旧版游戏根本不发）。

- 坐标显示从游戏里的 `CoordsHud` 搬到了 `02g-coords-overlay.js`：三行（彩色 XYZ；方块坐标和朝向；生物群系，不在主世界时
  加维度），风格和面板一致。聊天框、暂停菜单打开时保留（用户反映原来打字、按 ESC 会消失），F3、F1、不在世界里时隐藏。
  默认在左上角面板圆按钮下方（`top:48px`），可在 Mods 页换角。
- 面板 Stats 页加了 `FPS` 一行，读 `__eaglerGame.fps`，和游戏屏幕上的数字一致。
- `ClientFeatures` 只剩 `jade()`，坐标开关由页面自己读。
- 游戏本体已重编并换进仓库（构建 `32ccde69191f1424`）。启动检查确认主菜单时 `__eaglerGame` 有数据（`inWorld:false`、`fps`、
  `screen:3`）、坐标元素已建好、无页面错误；**进入世界后的坐标没在浏览器里看过**。用更早的游戏时坐标不显示、FPS 一行隐藏。预览页
  （`tools/panel_preview.py`）用一份假数据演示坐标显示。

## Paper 插件 JadeLite（让服务器上的提示条也显示箱子等内容）

`server-plugin/jadelite/`，成品 `release/jadelite-1.0.0.jar`，说明见那里的 README。回答 `jadelite:req`，格式与游戏内置
服务端一致。要点：Paper 只给客户端登记过的频道发消息，Eaglercraft 客户端不登记，所以插件在玩家进服时用反射调用
`addChannel`。**2026-11-15 已装到用户的 Paper 服务器上，用户确认在服务器里能看到容器内容**（反射 `addChannel` 在 Paper 26.2 上有效）。
客户端发 3 次没收到答复就不再问，所以装好插件后玩家要重新进服一次。

## 服务器推送资源包（“服务器当模组加载器”的基础）

2026-11-15 实测：服务器 `server.properties` 设了 `resource-pack`，客户端确实收到推送（日志
`ClientboundResourcePackPushPacket`、`server resource-pack push ... policy=ENABLED`），但**旧版游戏（构建
`21b0a73c5a7f5526`）里会失败**：下载或命中缓存后调用 `Files.setLastModifiedTime`，浏览器版不支持，抛
`UnsupportedOperationException`，整个包作废（`Pack 1 failed to download` / `Failed to store downloaded file`）。
新版源码 `HttpUtil.updateModificationTime` 已经 catch 这个异常，只记警告。**新版（`ea652f93`）上用户实测通过**：泥土名字变了。之后测试包已撤下、玻璃包恢复，WIT 插件（用 boss 条显示方块信息，和提示条重复）已停用。

- 测试包：`server-packs/test-pack.zip`（只把泥土英文名改成 `Dirt [server pack OK]`，pack format 88，sha1
  `58b1d1630015582b664076ae35afffed7ab5af43`），用 raw.githubusercontent.com 的分支地址托管，响应带
  `access-control-allow-origin: *`。
- 用户服务器现状：测试包替换了原来的 Borderless Glass 包，原配置备份在服务器的
  `backups/server.properties.bak-before-testpack`。撤回：清空 `resource-pack`、`resource-pack-sha1` 后重启。
- 游戏会按服务器条目记住“是否接受服务器资源包”（Multiplayer → Edit → Server Resource Packs），设成
  Disabled 时静默拒绝。用户那里是 Enabled。
- 查原因的方法：地址加 `?perfdebug`，**先**点 Record log **再**进服，进服那一刻的下载日志才录得到。

Modrinth 上（2026-11-15 查）Fabric、26.2、`client_side:unsupported` 的模组 3739 个，`optional` 943 个；大头是世界
生成（很多同时有数据包版，Paper 也能装），还有玩法类，以及靠 Polymer 库在服务端加新物品/方块/生物的 30 多个
（Polymer 26.2 版 `0.17.5+26.2`）。用 Fabric 服务端就不能用 Paper 插件（AuthMe 要换同类 Fabric 模组）。都没在
用户服务器上实际跑过。

## 和用户协作的约定

- 用户说要删某个功能时直接删，不用先确认。
- 用户很在意 relay token 的安全：不要把 token 写进任何会提交的文件。用户决定不用密码
  加密（嫌麻烦），所以给用户的个人构建用明文写法；加密写法和 `encrypt-token.html` 留着
  备用，不要主动推。
- 用户打不开 F12，需要看运行情况时让用户用面板的 Record log 录一段发过来。

## 自建服务器预设

用户在家里的 Windows 电脑上跑了原版 26.2 服务端 + `kkudzu/relay`（私有模式，需要 token），
用 Tailscale Funnel 得到固定地址，白名单已开。目标是 HTML 打开后不用手动填 relay 和 token。

- `local/home-server.json`（已加入 `.gitignore`，**可能含 token，绝不能提交**），两种写法：
  - 明文：`{ "name", "relay": "wss://...", "target": "127.0.0.1:25565", "token" }`
  - 加密：把 `token` 换成 `"enc": { "v", "iter", "salt", "iv", "data" }`
- `tools/encrypt-token.html`：独立页面，在用户自己的浏览器里用密码加密 token（PBKDF2-SHA256
  60 万次 + AES-GCM），输出加密写法的 JSON。这样 token 和密码都不用经过对话
- 两种写法都可以再加 `"panel": false`：这样构建出来的文件没有性能面板，也不显示启动时
  的 M1 横幅（渲染分辨率和 mesh worker 的调整照常生效）。给用户朋友的版本用这个
- 还可以加 `"features": {"coords": false}`（也可以是 `jade`、`coordsPos`）改这个构建里内置功能的默认值，`02f-features.js` 读它。
  没有面板的朋友版没法在游戏里切回去，所以要关什么就在这里关。玩家在面板里保存过的选择优先于它。
  **2026-11-16 起给朋友的版本是 `"panel": false` 加 `"features": {"coords": false}`**：用户要求关掉朋友的坐标，Jade 仍然开着
- `build.py` 的 `@@EAG:json:<路径>@@` 占位符：文件存在就内联成 JSON，不存在就是 `null`。
  模板里用它给 `window.__eaglerHomeServer` 赋值
- `02d-home-server.js`：启动前把这个 relay 写进 localStorage 的
  `_eaglercraftX.relay.list.v3`（base64 的 JSON 数组，字段 `name/address/private/token/
  capability/detected`），放在第一位；游戏用第一个支持 multiplayer 的 relay 连 Java 服务端。
  加密写法下，第一次加入或测试时用 `prompt()` 问密码，解开后 token 只存在游戏自己的
  relay 列表里（游戏本来就要把它存在那里），之后不再问
- 加入服务器用游戏自带的启动链接：在地址末尾加 `?server=<target>&transport=relay`。
  带这两个参数打开时，加密写法会先问密码
- 面板里原来有 My server 一栏（Join、Set address、Test、Lock），用户要求删掉了，不要再加
  回来。旧版本存在 localStorage `eaglercraft26.perfPanel.server` 里的地址（含 token）会在
  启动时被清除。要让浏览器忘掉已解锁的 token，可调用 `window.__eaglerHomeServerForget()`

状态：用户用明文写法的个人构建实际连进了自己的服务器（2026-11-11），所以 relay 列表
预设在这个构建上是有效的。用户反馈不加 `?server=...&transport=relay` 也能进（从游戏
自己的 Multiplayer 界面连），启动链接只是可选的捷径。加密写法测过加密、解密、错误密码
重试和解锁后免输入，但没有人实际用它连过服务器。注意：带了明文配置的构建产物里有
token，不要对它运行 `split.py`，也不要提交或公开。

服务器这边的现状（由用户电脑上的另一个助手维护，不在本仓库里）：relay 用所有人共用
的一个 token；试过“每人一个绑定玩家名的 token”，用户嫌每人一个文件太麻烦，退回了共用
token；防冒名改用服务端登录插件（Paper + AuthMe，玩家进服后 `/register`、`/login`）。
个人构建有两个：用户自己的带面板，发给朋友的不带面板（`"panel": false`），token 相同。

## 排查记录：地形有碰撞但看不见

用户反映原版文件就有：面前的地形是空白，但方块选择框能框到，单人和 LAN 都有。用
Record log 在 M1 Air 上录到的数据（新建随机世界，默认设置）：

- 全程 60 帧，最慢帧 17.7 ms；`?nomesh`（主线程内联建网格）下也一样，主线程很空闲
- mesh worker 1 个就绪，33 秒只完成 265 个任务，`queuedSections` 基本为 0，`errors` 为 0，
  任务数有长达 12 秒完全不涨的时段

结论：网格管线是空闲的，不是瓶颈，问题在上游。

`?perfdebug` 的录制（54 秒，单人新世界，玩家全程在移动）进一步确认是内置服务端供应
区块太慢：

- 客户端收到的 `ClientboundLevelChunkWithLightPacket`：前 15 秒 51 个，之后约 25 秒
  一个都没有，玩家慢下来后才又来了 35 个。全程共 86 个，约 1.6 个/秒
- 同期收到 119 个 `ClientboundForgetLevelChunkPacket`，卸载的比加载的多
- 没有区块的那 25 秒里 `SetChunkCacheCenter` 和 `SetTime` 照常到达，服务端没卡死
- `level render ... visible=0` 持续了约 35 秒：玩家已经走出所有已加载的区块
- 客户端各阶段耗时都在 1 ms 以内，`packet queue depth=0`，客户端没有积压

也就是玩家移动的速度超过了浏览器里服务端生成新地形的速度。`?perfdebug` 只能录到
客户端的 `[EagPerfClient]`，服务端 worker 的 `[EagPerf]` 日志不会转发到页面，所以服务端
内部哪一步慢还没有数据。JS 层改不了生成速度；能缓解的是调低渲染距离、少在新地形里
高速移动，根本办法是用原生 Java 服务端。

## 排查记录：在自建服务器上移动时掉帧

2026-11-12 用户在家里的 Paper 服务器上录到：平静时 60 帧，区块成批到达时掉到 16–45 帧，
清晰度已是 1x、mesh 队列没有积压，一分钟里有 627 个含流体的区块段在主线程内联建网格
（`fluidInline`）。原因是 **macOS 开着低电量模式**，关掉后稳定 60 帧。

以后用户再反映卡顿，先问是否开着低电量模式（系统设置 → 电池），以及 Chrome 的节能
模式（设置 → 性能）。低电量模式下 CPU 被限速，主线程处理不过来成批到达的区块；这时
能缓解的是调低渲染距离，或在服务端限制每个玩家的区块发送速率。

## 排查记录：自建服务器上区块不再加载

2026-11-12 用户反映玩一阵后新区块不加载。日志：60 帧、区块线程全空闲、队列为 0，下载
速度全程 0，上传 0.6–0.8 KB/s（只有位置包）；用户确认已登录 AuthMe、不会被拉回原地。
面板的下载速度以 B/s 显示，持续为 0 就说明服务器连时间同步包都没送来，即连接卡死
（能发不能收），不是“服务器在发但区块慢”。候选原因：Tailscale Funnel 有不可配置、
未公布数值的带宽限制（官方文档）；服务端或 relay 卡住。为区分这些，加了上面的 NO DATA
警告，并让用户在卡住时看 Connection 一行、刷新页面后看是否恢复、让另一个助手只读检查
Paper 日志、TPS、relay 日志和 `tailscale funnel status`。未确认根因。

## 源码参考

本仓库只有编译产物，没有 Java 源码。需要读游戏逻辑（例如 LAN world、relay）时，
克隆下面的公开仓库到仓库目录之外再阅读，不要把它们复制进本仓库（约 330MB）：

- `https://github.com/kingjoeishere/Eaglercraft-26.2-u2-workspace` — 26.2 的 Java
  源码工作区（比本仓库的构建略新，不完全一致）
  - LAN 房主侧：`platform-teavm/src/main/java/net/lax1dude/eaglercraft/v1_8/sp/internal/ClientPlatformSingleplayer.java`
  - P2P 房主：`platform-teavm/src/main/java/net/lax1dude/eaglercraft/v1_8/internal/teavm/LegacyLANHost.java`
  - relay 配置：`game/src/main/java/net/lax1dude/eaglercraft/v1_8/sp/relay/RelaySettings.java`
  - 内置服务端主循环：`game/src/main/java/net/minecraft/server/MinecraftServer.java`
- `https://github.com/kkudzu/relay` — 默认 relay 的服务端源码（`src/lan-rooms.js`、
  `cloudflare/worker.js`），LAN 房间人数上限和限流都在这里

克隆命令（公开仓库，无需授权）：

    GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 <url> /home/user/<owner>/<repo>
