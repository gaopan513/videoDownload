# StreamHarbor Windows 桌面端

Windows x64 中文网页视频下载工具，当前版本 1.0.1。本说明于 2026-10-11 按源码、发布包与已保存验收报告核对。以下开发命令均在 windows/ 运行；其他端见 [浏览器扩展](../extension/README.md)、[iPhone 原型](../ios/README.md)。

1.0.1 已修复多窗口媒体归属、重新下载取消竞态、HLS 重定向、YouTube 清晰度、Bilibili 分 P、抖音备用解析及搜索状态问题。Bilibili 多段 `durl` 目前明确拒绝，不会只保存首段并显示完成；YouTube 指定清晰度不再静默降级。本次安装包和便携版包含这些修复。

当前交付为 2026-10-11 的 1.0.1，保留蜘蛛网图标、Meta/YouTube 解析和现有搜索/下载功能：

| 文件 | 用途 |
| --- | --- |
| [StreamHarbor Setup 1.0.1.exe](<release/1.0.1/StreamHarbor Setup 1.0.1.exe>) | 安装包 |
| [StreamHarbor 1.0.1.exe](<release/1.0.1/StreamHarbor 1.0.1.exe>) | 便携版 |
| [SHA256SUMS.txt](release/1.0.1/SHA256SUMS.txt) | 本地文件校验值 |

旧版安装包、便携版及相关发布目录已清理；历史验收记录保留。当前包的验证范围见 [VALIDATION.md](VALIDATION.md)。

## 使用

1.0.1 位于 `release/1.0.1/`：`StreamHarbor Setup 1.0.1.exe` 为安装包，`StreamHarbor 1.0.1.exe` 为便携版。EXE、安装/卸载图标、主窗口和侧栏品牌标识采用同一蜘蛛网视频图标，保留当前客户端功能和应用标识。构建时保留 EXE 资源编辑，仅关闭代码签名。

图标源资源为 `build/spiderweb.ico`（16/24/32/48/64/128/256 像素）及 `build/spiderweb.png`。仓库根目录执行 `powershell -File scripts/generate-app-icons.ps1 -Target Windows` 可从扩展的生成原图重新导出。

使用上表安装包或便携版。粘贴网页、MP4 或 M3U8 地址，选择资源、清晰度和目录后下载。只下载有限视频，不录制直播。

1. 每行粘贴一个网址，点击“解析链接”；最多一次 30 个。
2. 选择资源、清晰度和音轨。单一候选默认选中；选择保存目录，点击“下载所选”。
3. 在队列中暂停、继续、取消或逐条删除任意状态的记录。删除运行中的记录会先停止任务并清理临时分片，已完成的视频文件保留。失败可重试；“重新下载”会重新解析并清除旧分片，需要确认。
4. 不兼容 MP4 时选择转码 MP4 或无损 MKV。完成后点击“打开文件位置”。

Instagram 支持帖子、Reel / Reels 与 TV 视频链接；Facebook 支持 Watch、视频、Reel、分享链接与 `fb.watch` 短链。粘贴后照常解析、选择画质并下载。需要登录或验证时，点击输入框下的“访问平台”，在独立窗口完成后返回工作台重新解析；两站分别保存本机登录会话。一次输入多个平台链接时，“访问平台”打开其中首个链接。

两站使用页面与 JSON 响应中的完整 MP4 字段，避免把播放器的分离轨道当作完整视频。只提供 DASH 时会明确提示不支持；视频是否含音频取决于平台提供的 MP4。Windows 的 Instagram 样本通过整片下载及深度解码；Facebook 两个现场页面未打开，真实下载未验证。浏览器扩展的 Facebook 成功记录不能替代桌面验收，具体见 [VALIDATION.md](VALIDATION.md)。

另有 Bilibili、抖音、快手、微博、小红书、西瓜与 Twitter/X 专用解析分支；这些分支按平台接口或页面数据提取候选，本轮文档核对未进行其真实下载复验，不承诺所有短链、清晰度、登录或地区受限内容可用。

“搜索发现”的“网页搜索”可用 Google 或 DuckDuckGo 在应用内窗口搜索；这两个窗口默认加载 [AdRules](https://raw.githubusercontent.com/tickmao/ADrules/master/AdRules.txt) 过滤网页请求和广告元素，客户端每次启动会自动更新规则，更新失败时沿用上次成功缓存。规则仅作用于网页搜索窗口。打开视频页面后，从窗口“网页”菜单选择“复制当前页面网址”（或按 Ctrl+L），回到下载工作台粘贴解析。也可右键搜索结果复制链接地址。下方跨站搜索仍可搜索已适配站点的片名，按站点加载更多，打开详情后选线路、多选或全选剧集，再按“下载所选”。批量任务进入下载槽位时才解析播放入口；多个媒体候选需在下载工作台选择清晰度或音轨。下载目录可在剧集页单独选择。

“资源站点”可修改名称、入口、适配器与启用状态，访问站点完成登录或验证、清除该站点登录状态，并预览导入冲突或导出配置。配置文件只含站点设置；站点 Cookie 保留在 Electron 的独立持久化会话。现有 SOTVLA、大米星球、毒舌保留独立适配器；绿色影视与嘀嗒影视共用 Myui。旧配置中的 LibVio 和片库入口会移除，其已删除的适配器若用于其他自定义站点，则改为“未适配”。详见 `VALIDATION.md`。

新增站点时，先按搜索表单、结果卡片、详情线路和剧集链接选择相符的适配器；仅有相似网址不够。无匹配类型时保存为“未适配”，这只保存入口和独立会话。完整适配需在 `src/main/sites.ts` 增加搜索、分页、结果、线路和播放链接解析，在 `src/shared.ts` 与 `src/ui/SitesView.vue` 注册类型，再用真实 Electron 会话核对。只有单条播放链接时，可直接在“下载工作台”粘贴尝试通用解析。

偏好设置支持同时 1–4 个任务，每任务 1–16 个并发请求；默认 2 / 8。代理留空使用系统设置；也支持 HTTP、HTTPS、无认证 SOCKS5。HTTP 代理可用 `http://username:password@host:port`，特殊字符需 URL 编码。Chromium 不支持带密码的 SOCKS5，应用会明确拒绝此配置。修改设置前请暂停任务并等待解析结束。

## 能力与限制

- 静态 HTML 视频地址发现、隐藏 Chromium 网络捕获与自动尝试播放，支持动态页面与 iframe。登录、验证码、播放器特殊交互或站点保护可能导致无法解析。
- MP4 Range 分段、哈希检查与断点恢复。服务器不支持 Range 时使用单连接；暂停后继续从头下载。响应资源标识改变时保留旧数据，不混合不同内容。
- HLS 主列表、清晰度、独立音轨、TS/fMP4、初始化片段、相对地址、字节范围及 AES-128（显式/隐式 IV、密钥轮换）。分片按清单完成后再合并。
- 有 `EXT-X-ENDLIST` 的有限播放列表才接受下载。不支持直播、DASH、SAMPLE-AES 或 DRM。不会绕过登录和权限。
- 默认无损封装 MP4；不兼容时由用户选择转码 H.264/AAC 或 MKV。快速检查不保证每一帧无损坏，可启用深度解码校验。
- 地址授权失效时自动重新解析一次。只有资源地址、清晰度及音轨一致才自动尝试续传，下载引擎还会校验恢复记录；新签名 URL 等无法证明一致的情况要求重新下载。
- 单个 HLS 分片当前内存读取上限 256 MiB；超限明确报错。大型媒体建议保持默认或较低并发。音轨下载在视频分片完成后进行，HLS 进度显示当前轨道分片数与分片/秒。
- 取消删除本任务临时数据；暂停、失败保留。合并阶段暂停后需重新合并。清理分片会丢失已下载进度，不删除最终视频。
- 任务记录保存到 Electron 的本机用户数据目录；敏感 URL、会话信息与代理配置用系统加密保存。完成或取消后移除该任务凭据。不能将加密记录直接复制到另一台电脑续传。
- 下载目录中的 `.streamharbor/<task-id>` 保存恢复记录与媒体分片，恢复清单不保存远程 URL 或密钥。媒体临时文件本身未加密。
- 网站兼容性不作全覆盖承诺。真实样本及验证局限见 `VALIDATION.md`。

## 开发与构建

需要 Windows x64、Node.js 24 LTS 和 npm。运行环境自带 Chromium、FFmpeg、FFprobe，用户机器不需安装这些开发依赖。

```powershell
npm ci
node scripts/prepare-media.mjs
npm test
npm run build
npm run dev
npm run package
```

若二进制安装脚本因缓存或网络限制失败：

```powershell
npm ci --ignore-scripts
$env:electron_config_cache = Join-Path (Get-Location) '.tools/electron-cache'
node node_modules/electron/install.js
node scripts/prepare-media.mjs
```

FFmpeg/FFprobe 使用 `media-lock.json` 的版本与 SHA-256 固定，`prepare-media.mjs` 下载并校验。安装脚本产生的 FFmpeg LICENSE/README 也应保留用于打包。`python scripts/build-windows.py` 是当前开发机可用的可选构建入口，会让构建工具使用 Python 识别到的系统代理，不打印代理凭据。

`npm run smoke` 在独立测试数据目录启动 Electron，执行真实 UI、后台解析、站点搜索与批量下载校验，生成 `artifacts/desktop.png`、`artifacts/search-ui.png`、`artifacts/sites-ui.png` 和测试报告。先运行核心测试生成测试视频，再运行 npm run build 生成 Electron 所需的 dist。该冒烟使用受控站点响应，不等同真实网站下载通过。Meta 集成脚本为 node scripts/test-meta-desktop.mjs；现场探针 node scripts/probe-meta-live.mjs 会访问真实平台。

`npm test` 包含任务取消、搜索状态、平台解析和下载回归；YouTube 格式选择测试离线调用 `build/yt-dlp.exe`，需先完成媒体组件准备。`node scripts/test-resolver-desktop.mjs` 另行使用本地 HTTP 夹具及隐藏 Electron 窗口，验证同一登录会话的媒体隔离、并发解析排队和 Cookie 保留。

## 模块

- `src/core`：网络与代理、播放列表、解密、恢复清单、分片调度和媒体处理。
- `src/core/meta.ts`：将仓库同级 `extension/src/core/meta-media.ts` 的共享 Meta 解析结果转换为桌面候选；开发构建需要保留同级 `extension/` 源码，打包程序已嵌入解析代码。
- `scripts/export-source.py`：源码 ZIP 保留 `windows/` 与共享 `extension/src/` 层级；解压后进入 `windows/` 安装依赖和构建。
- `src/main`：Electron 窗口、会话、后台发现、受限 IPC、安全存储和下载进程。
- `src/ui`：Vue 中文界面。
- `tests`：本地 HTTP 与 FFmpeg 生成的可控资源，不依赖第三方视频。
- iPhone 原型在仓库同级目录 [`../ios/`](../ios/README.md)，与桌面端分别构建。

开发计划在仓库根目录的 [`task_plan.md`](../task_plan.md)；调查结果在 [`findings.md`](../findings.md)；开发记录在 [`progress.md`](../progress.md)。依赖与媒体许可证见 [THIRD_PARTY.md](THIRD_PARTY.md)。当前交付为未签名个人使用构建。


在下载队列或已完成页面点击“清除完成记录”，可移除全部完成记录。视频文件和未完成任务保留，清除结果在重启后仍生效。
