# better-26

Eaglercraft 26.2 单文件 HTML 的拆分版本。原始文件约 75.6MB，其中 99.8% 是内嵌的
base64 数据块；为了便于阅读和修改代码，仓库里保存的是拆分后的文件，单文件 HTML
由脚本重新生成。

## 目录结构

- `src/index.template.html` — HTML 骨架，被拆出去的内容在原位置换成占位符
- `src/js/` — 8 段内联脚本，按在页面中出现的顺序编号
  - `01-brotli-decoder.js` — Brotli 解码器（已压缩，不可读）
  - `02-inline-payload-loader.js` — 内联数据块的加载与 fetch 拦截
  - `02b-m1-air-profile.js` — 渲染分辨率控制与 MacBook Air M1 性能配置（后加的）
  - `02c-perf-panel.js` — 屏幕左上角的性能面板（后加的）
  - `02d-home-server.js` — 自建服务器预设（后加的，见下文）
  - `03-debug-flags.js` — URL 调试参数与诊断开关
  - `04-teavm-wasmgc-runtime.js` — TeaVM Wasm-GC 运行时（已压缩）
  - `05-worker-bootstrap.js` — 页面与 worker 共用的 Wasm-GC 启动逻辑
  - `06-main.js` — 主入口（`type="module"`）
- `src/css/style.css` — 加载界面、横屏提示等样式
- `src/img/` — 页面图标 `icon.png` 和启动图 `boot.png`
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

## 性能面板

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
