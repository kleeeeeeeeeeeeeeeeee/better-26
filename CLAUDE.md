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
像素填充。mesh worker 上限这一项没有单独实测过。由于加了这个文件，`build.py` 现在会报告与原文件不同，属于预期。

## 性能面板

`src/js/02c-perf-panel.js` 在左上角显示帧率小标签，点击展开面板：最差帧时间、游戏帧
时间（进入世界后）、画布分辨率、mesh worker 状态，以及 1x / 1.5x / Native 三个渲染
分辨率按钮。按钮通过 `window.__eaglerRenderScale.set()` 即时生效（游戏每帧重读
`devicePixelRatio`），选择存在 localStorage 的 `eaglercraft26.renderScale` 里，在所有
机器上都可用。`?panel=0` 关闭面板。

- 帧率是用 `requestAnimationFrame` 的回调间隔估的，不是游戏内部的计数。
- 页面的 `<meta charset>` 在 75MB 之后才出现，新增的 JS 只用 ASCII 字符，界面文字用英文。
- 游戏全屏的是 `#game_frame`，面板在全屏时会被移进去，否则看不到。
- 面板用 `<div>` 而不是 `<button>`，避免获得键盘焦点后被游戏里的空格/回车触发。

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
