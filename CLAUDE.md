# better-26

Eaglercraft 26.2 单文件 HTML 的拆分版本。原始文件约 75.6MB，其中 99.8% 是内嵌的
base64 数据块；为了便于阅读和修改代码，仓库里保存的是拆分后的文件，单文件 HTML
由脚本重新生成。

## 目录结构

- `src/index.template.html` — HTML 骨架，被拆出去的内容在原位置换成占位符
- `src/js/` — 6 段内联脚本，按在页面中出现的顺序编号
  - `01-brotli-decoder.js` — Brotli 解码器（已压缩，不可读）
  - `02-inline-payload-loader.js` — 内联数据块的加载与 fetch 拦截
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
