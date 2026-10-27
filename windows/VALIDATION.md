# Windows 验证报告

## 2026-10-11 Windows 1.0.1 安装包

已生成 `release/1.0.1/StreamHarbor Setup 1.0.1.exe`（177,837,877 字节）和 `StreamHarbor 1.0.1.exe`（便携版，177,385,055 字节），包含下节9项源码修复。应用、package.json、lockfile和EXE版本均为1.0.1。

- 类型检查、Vite和主进程构建通过；媒体组件SHA-256校验通过。
- 包内3个主进程bundle和3个UI文件与本次dist逐字节哈希一致；FFmpeg、FFprobe和yt-dlp均存在。
- 打包目录的实际EXE通过26项桌面冒烟，包括独立下载进程、媒体合并/深度校验、跨源iframe、登录复用、搜索、批量队列和任务记录恢复。
- 两个EXE的内嵌7z数据完整性检查通过；从安装包和便携版各提取app.asar到内存，确认与已运行验证的包完全一致。7-Zip提示的archive尾部数据为EXE封装；完整性检查退出码均为0。
- 哈希、包检查与打包版冒烟结果分别保存在该目录的 `SHA256SUMS.txt`、`package-validation.json`、`packaged-smoke-results.json`。
- 按用户要求删除13项旧发布文件/目录，共4,115,894,955字节（约3.83 GiB）；清单见 `old-artifacts-cleanup.json`。目前release仅保留1.0.1；源码和历史验收记录保留。

未在本机执行安装器安装/卸载或便携自解压启动；现有验证针对实际打包应用和EXE内嵌负载。没有联网发布；仍为未签名构建。

## 2026-10-11 Windows 源码审查修复

本次修复9项问题：同会话多窗口媒体串线、重新下载取消竞态、HLS重定向基准、YouTube清晰度降级、Bilibili分P和多段响应、抖音HTML备用解析、搜索站点范围和分页关键字。Bilibili多段目前明确提示不支持；不实现分段拼接。同一站点会话的通用解析排队执行，保留登录，等待计入已有超时。

- 新增回归先在旧逻辑上失败，再验证修复；`node scripts/test.mjs` 最终77/77通过（原有49项，新增28项），输出见 `artifacts/core-tests.txt`。
- `npm run build` 类型检查及前后端构建通过。
- `node scripts/smoke.mjs` 26项通过，包含真实Electron下载/深度媒体校验、跨源iframe、搜索与批量队列、记录持久化和删除。报告见 `artifacts/smoke-results.json`；取消解析时出现的预期IPC错误不属于失败。
- `node scripts/test-resolver-desktop.mjs` 通过：本地HTTP夹具、隐藏Electron窗口，同Session的B窗口媒体不能污染A；并发C解析排队，登录Cookie保留。脚本断言每条夹具路径实际执行，并清理自己的临时目录。
- 下载回归包含FFmpeg生成的真实HLS媒体、302后相对分片与深度解码；YouTube使用随项目yt-dlp执行离线格式选择，确认2160p优先及缺失分辨率不降级。

本次没有真实网站整片下载、安装器安装/卸载或新EXE打包。`dist` 已更新，历史 `release` 中的安装包、便携版及源码ZIP未变，不包含本次修复。当前目录没有Git元数据，无法提供提交号或Git差异统计。

## 历史交付与核对范围（2026-10-09）

当前交付为 release/spiderweb-20261008/ 的 1.0.0 蜘蛛网图标版，安装入口见 [README.md](README.md)。本轮直接读取发布目录 app.asar：主进程与当前 dist/main/main.cjs 逐字节一致，包含 Meta、国内平台、Twitter/X 解析分支和 Myui Cloudflare 等待逻辑。

已有功能验收、真实站点测试和图标核验分别见下方历史报告；本轮只核对文档、包内代码、版本、路径与文件摘要，没有重跑站点下载。Windows Facebook 现场下载未验证；iOS/扩展的结果不作为桌面验收。安装器安装/卸载和便携自解压启动仍未单独验证。


## 2026-10-10 YouTube yt-dlp 独立下载通道

本轮以“独立通道、不改动任何现有平台解析”的方式新增 YouTube 下载。新增 `src/core/youtube.ts`（链接规范化与 11 位 ID 提取，兼容 watch / youtu.be / shorts / embed / live / 无协议粘贴，丢弃 `t`、`si` 等无关参数）、`src/core/ytdlp.ts`（yt-dlp 子进程封装：元数据拉取、DASH 音视频下载与合并、按 filename 累加多流进度、Windows 进程树取消、错误中文化）与 `src/main/youtube.ts`（主进程分派）。清晰度不硬编码 itag，改用动态格式选择器，优先 avc1 视频 + mp4a 音频的 https 直链以保证 MP4 通用兼容，逐级降级。yt-dlp 负责解析 sig/n 参数签名并下载分离的 DASH 音视频后用随包 FFmpeg 合并为单个 MP4；产物回到引擎既有的 probe → remux → 硬链接落盘流程，任务状态、字节进度、暂停续传（yt-dlp 自带 `.part`）、取消与“打开文件位置”全部沿用。解析在 `resolver.discover` 的 Twitter 分支后插入，对其它平台零影响。

49 项桌面 Node 测试、Vue/TypeScript 类型检查（`vue-tsc --noEmit` exit 0）与 `npm run build`（vue-tsc + vite + esbuild）通过；生产产物中下载子进程 `dist/main/worker.cjs` 与主进程 `dist/main/main.cjs` 均确认包含该通道（yt-dlp 调用/进度模板与解析分派/路径定位字符串命中）。为满足 `Job.ytdlp` 必填，仅在三处既有测试 Job 构造中补 `ytdlp: ''`，不改测试逻辑；现有 B站/抖音/快手/微博/小红书/西瓜/Twitter/Meta/影视站等 49 项测试全部通过，证明无回归。

真实链接 `https://www.youtube.com/watch?v=EMdSr1OciVc`（标题《Pi Agent 零基础入门…》，UP「Kai on AI」，时长 980 秒）解析出 6 档去重清晰度：1080p50 / 720p50 / 480p / 360p / 240p / 144p。为快速验收选取最低档实下载：avc1 视频 f160 + 默认中文原声 m4a f140，经引擎 `download()` 完整链路合并落盘，输出 22,101,519 字节 MP4，H.264 256×144@25fps + AAC 立体声 44100Hz，时长 979.975 秒（含完整音视频流），SHA-256 `71f74bd31b633960d327248b15c4984b65443e03428eba811d90cea3dc0bec9c`（物证保留于 `artifacts/yttest4/video.mp4`）。可复现脚本 `scripts/verify-youtube.mts` 经 tsx 运行真实解析与下载、ffprobe 校验后输出 `E2E OK`，临时目录校验后清理；最终文件以安全命名落入下载目录，即“下载完成 + 可打开文件位置”所揭示的路径。

打包形态以 `npx electron-builder --win --x64 --dir`（exit 0）验证：`release/win-unpacked/resources/bin/` 同时包含 ffmpeg.exe、ffprobe.exe 与新增 yt-dlp.exe（17.0MB）；打包内 `yt-dlp.exe` 的 SHA-256 `66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a` 与开发源 `build/yt-dlp.exe` 逐字节一致，且代码定位 `process.resourcesPath/bin/yt-dlp.exe` 与 `package.json` 的 `extraResources`（`build/yt-dlp.exe → bin/yt-dlp.exe`）精确匹配。捆绑组件为 yt-dlp 2026.08.19，Unlicense（公有领域），来源与哈希已记入 `THIRD_PARTY.md`。完整证据（测试数、构建、真实下载 ffprobe 字段、哈希、改动文件清单与未触碰的现有平台解析器清单）见 `artifacts/youtube-validation.json`。

未验证项与交付限制：未运行 NSIS 安装器安装/卸载与便携版自解压启动（仅验证 `--dir` 解包目录与 resources/bin 内容）；未在干净 Windows 虚拟机验收；未验证 YouTube 会员、年龄限制、私密或需登录内容；暂停续传依赖 yt-dlp 自带 `.part`，未做长时间断点的人工 UI 全流程实测；代理透传参数已接入但未用真实代理端到端验收。yt-dlp 缺失时仅 YouTube 通道给出中文错误，不影响其它平台下载（不占用会全局阻塞的 tools 状态）。

## 2026-10-08 Instagram / Facebook 专用解析

Windows 原先仅提供通用网页嗅探，未提供 Meta 专用适配。本轮复用 `extension/src/core/meta-media.ts`，增加初始页面 / OpenGraph / JSON 响应解析、清晰度选项与两站分别持久化的登录会话；粘贴链接后可点击“访问平台”完成登录 / 验证，再回工作台解析。Facebook 分享短链在最终页面按视频 ID 筛选；动态响应按主框架、loader、请求发起页面与导航世代归属，避免旧页面响应污染新视频。只接收完整 MP4 字段，原始网络分离轨道不会成为候选，DASH-only 明确报错。

49 项桌面 Node 测试、13 组共享插件解析、Vue 类型检查与前后端构建通过。开发与最终打包目录分别通过 8 项 Meta Electron 集成检查和 26 项原有冒烟检查，覆盖真实 UI / IPC、短链重定向、动态 XSSI JSON、两种清晰度、原始 MP4 排除、跨 SPA 导航的延迟无 ID 响应、登录窗口复用 Cookie、无 app preload、取消清理、DASH 错误与任意网址拒绝。独立正确性审查指出的延迟响应归属问题已修复并复审通过。Meta 集成用可控协议响应，不能等同线上下载成功。

现场 Instagram `https://www.instagram.com/reel/Chunk8-jurw/` 在隔离 Electron 会话完成解析、客户端下载、封装及逐帧解码：输出 918237 字节，H.264 480×854，4.966667 秒。平台提供的此 MP4 只有视频流，没有音频流。Facebook 的视频 `1040750538995454` 与 Watch 视频 `10154122520715466` 均在页面导航阶段无法打开，因此真实候选 / 完整下载未验证。没有使用历史插件报告替代本轮证据。

证据：`artifacts/meta-desktop-validation.json`、`artifacts/meta-desktop-packaged-validation.json`、`artifacts/meta-live-validation.json`、`artifacts/meta-release-validation.json`。安装包为 `release/meta-20261008/StreamHarbor Meta Setup 1.0.0.exe`（159714877 字节，SHA-256 `A295438F3E6DF0CCED1764D050844ADA2B20DB9A6D28E446B8EC25964ECD272C`），便携版为 `release/meta-20261008/StreamHarbor Meta 1.0.0.exe`（159485013 字节，SHA-256 `BE84B862181B092508179E8DDA65D99B0E49B8FDC2D9C9AE5629C19A61E14B71`）。运行验证针对对应的 `win-unpacked/StreamHarbor.exe`；安装器安装 / 卸载与便携自解压启动未单独验证。

本轮没有 Git 元数据，按本次文件清单审查。独立 Meta 集成 / 现场 profile 与下载由脚本清理；保留历史产物、已有测试数据和其他任务修改。源码导出已改为保留 `windows/` 与共享 `extension/src/` 层级，打包运行时不需要同级插件源码。

## 2026-10-08 绿色影视搜索验证等待修复

原生 Electron 取证：绿色影视主页加载后 800ms 仍为 Cloudflare 整页安全验证，没有搜索表单；追加等待 8 秒后验证自动完成，仍出现原有 `searchword`、GET `/search.php` 表单。原客户端读取过早，将验证页误报为“站点搜索表单结构已变化”。现改为同窗口最多追加 10 秒等待自动验证，未完成返回 `ACCESS` 并提示通过“访问站点”验证后重试；沿用站点独立 Cookie 会话与取消清理。只有 Cloudflare 整页挑战触发等待，正常 JSD/Turnstile 脚本不触发。JSD 与整页挑战的区分参考 [Cloudflare 官方说明](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/)。

42 项自动化、Vue/TypeScript 类型检查与客户端构建通过。新增原生 Electron 本地行为验证 5 项：自动验证跳转后再搜、Cookie 保留、详情剧集、验证持续未完成正确报错、取消销毁隐藏窗口；包含重试复用会话。执行 `node scripts/build-site-runtime.mjs` 后，用 Electron 运行 `scripts/test-myui-search.cjs`；结果见 `artifacts/myui-search-tests.json`。独立正确性审查提出的 JSD 误判和测试取消断言问题均已修正并复核。

真实原生 Electron 搜索“绿灯军团”：绿色影视 1 条结果，2 条线路各 8 集；嘀嗒影视 1 条结果，8 条线路。结果见 `artifacts/myui-search-live-20261008.json`，首页取证见 `artifacts/myui-search-dom-20261008.json`。本轮验证搜索和详情，不包含媒体解析或整集下载。

已生成独立命名的安装包与便携版，位于 `release/myui-search/`。对应打包目录程序的 26 项既有 Electron 冒烟通过，覆盖搜索 IPC、Cookie 会话、下载队列、广告规则及界面，结果见 `artifacts/myui-search-packaged-smoke.json`。安装器安装/卸载和便携版自解压启动未单独执行。

另用无调试连接的原生 Electron 加载最终 `app.asar`，经真实 `search`/`detail` IPC 验证两站搜索和剧集成功，结果见 `artifacts/myui-search-packaged-native.json`。带 Playwright 调试连接的成品界面仍遇到 Cloudflare 验证，但界面正确显示“站点安全验证尚未完成”，并提供“访问站点”和“完成并重试”；该场景未取得真实搜索结果，记录见 `artifacts/myui-search-packaged-debug-status.json`。

安装包 `StreamHarbor-1.0.0-myui-search-setup.exe`：159,714,769 字节，SHA-256 `A180D3726475763EDB5033CE4E3E6484D5713DC9F9E8F00D5D37F92955A5EA9F`。便携版 `StreamHarbor-1.0.0-myui-search-portable.exe`：159,484,876 字节，SHA-256 `EF6F27700B3EF06BD1BC752ACA197587313D26161EA96B39B631B7DFE63D312B`。共享 `dist/ui` 在首次打包过程中被另一构建更新，因此本轮使用独立快照与输出目录；不覆盖标准文件名的发布包。

## 2026-09-29 网页搜索广告过滤

Google 与 DuckDuckGo 内置窗口共用专用 `persist:web-search` Electron 会话，启动后加载指定 AdRules 列表，过滤网络广告请求和页面广告元素；每次启动更新，失败时沿用上次成功缓存。资源站点访问、播放解析及下载会话不使用这套过滤规则。首次没有缓存且更新失败时仍允许打开搜索窗口，界面提示规则不可用。

41 项自动化测试、Vue 类型检查、开发程序与打包目录各 26 项 Electron 冒烟通过。冒烟以本地规则和页面证明：每次启动请求规则；HTTP 503 时仍加载缓存；两个搜索入口打开内置窗口；专用搜索会话拦截广告脚本，隐藏广告元素。打包程序还通过真实指定 URL 下载并缓存 5,346,117 字节规则。未逐条评估整个第三方列表对实际搜索结果的误拦截率。

安装包 `release/StreamHarbor Setup 1.0.0.exe`：159,710,800 字节，SHA-256 `67F252201C3D9E9D70073F4B40816A7737665AA33A0B7DEEF7A58139FF65780D`。便携版 `release/StreamHarbor 1.0.0.exe`：159,480,934 字节，SHA-256 `16E9BEE2DAE3430F9582BEEE572F739A6575C08CCD642D90F93DBCD4844AE24B`。验收运行了对应的打包目录；安装器安装/卸载和便携版自解压启动未单独执行。

## 2026-09-29 网页搜索内置窗口

Google 与 DuckDuckGo 现在由应用内独立 Electron 窗口打开，不再调用系统默认浏览器。窗口没有应用 preload/IPC，使用独立持久化会话；“网页”菜单提供复制当前页面网址、后退、前进和刷新，右键链接可复制链接地址。下方旧章节中的“系统默认浏览器”描述属于此前版本。

41 项自动化测试、类型检查、开发及打包目录各 25 项 Electron 冒烟通过。冒烟实际点击两个搜索按钮，验证创建两个应用窗口，并以原生输入事件确认 Ctrl+L 复制当前页面 HTTPS 网址。安装包和便携版已更新；便携版在进程关闭后与新构建产物按 SHA-256 核对一致。外部搜索服务的结果内容和目标视频下载成功率未计入。

## 2026-09-29 LibVio 移除与网页搜索

本版移除 LibVio 预置站点及 Stui 适配器。`sites.json` 迁移至 `catalogVersion: 4`：删除 LibVio 条目；其他曾使用 Stui 的自定义站点保留，并改为未适配。Google 与 DuckDuckGo 搜索入口在“搜索发现”顶部，使用系统默认浏览器；输入关键词或留空打开搜索首页，用户自行复制目标视频网页链接到下载工作台。

41 项自动化测试、Vue 类型检查、开发及打包目录各 25 项 Electron 冒烟检查通过。自动化核对了两个搜索入口、引导文案、站点移除、URL 编码和原有搜索/下载流程；外部浏览器中的实际搜索结果与视频下载成功率不在此次验证范围内。

## 2026-09-29 搜索详情与站点清理

已移除片库预置站点与专用适配器；下方“五站适配”记录为此前版本的历史取证。旧配置加载时会删除片库预置条目，并将自定义站点上残留的 `pianku` 适配器改为未适配。

LibVio 搜索“年会不能停2”在原生 Electron 中返回“年会不能停！2”；详情页仅有一个“立即播放”链接，修复后解析为 1 条在线播放线路、1 个入口。其播放页的媒体探针未发现可下载候选，未验证整片下载。41 项自动化测试、类型检查、开发与打包目录各 23 项 Electron 冒烟检查通过，包含选中站点置顶及重试结果反馈。

## 2026-09-29 五站适配与分类

原生 Electron 页面取证表明：LibVio 为 Stui 播放列表；绿色影视和嘀嗒影视共用 Myui 剧集容器，播放 URL 中的线路编号可通用分组；片库与大米星球同为 `vodsearch/voddetail/vodplay` 路由，但片库的结果和播放区布局不同，需独立页面解析。按用户本轮要求，星河看不加入站点列表。

四个新适配器在原生 Electron 会话中均完成片名“绿灯军团”搜索和详情解析：LibVio 1 条结果、1 条线路 7 集；片库 2 条结果，首条样本只有一个可见播放入口；绿色影视 1 条结果、2 条线路各 7 集；嘀嗒影视 1 条结果、7 条线路。绿色影视页面显示“下一页”但尾页仍为 1，现已按尾页和重复结果停止分页。记录见 `artifacts/template-adapters-search-detail.json` 与 `artifacts/five-sites-initial.json`。这一级别只证明搜索、详情和剧集入口，不代表媒体候选或整片下载成功。

39 项核心/站点测试、Vue 类型检查、前端与主进程构建通过；开发程序的 Electron 冒烟包含站点配置、搜索/详情、批量下载与原有任务流程，结果见 `artifacts/smoke-results.json`。

媒体发现：LibVio 首集取得 1 个 MP4 候选，绿色影视 2 个 HLS 候选，嘀嗒影视 1 个 HLS 候选。片库的两条同名结果分别有 1 和 6 个剧集入口，但两条首集都未发现媒体候选；一次播放页原生导航超时。记录见 `artifacts/libvio-media.json`、`artifacts/template-adapters-media.json`、`artifacts/template-adapters-pianku-alternate.json`。四站均未做整集下载及深度媒体校验。

最终打包目录 `release/win-unpacked/StreamHarbor.exe` 完成 22 项 Electron 冒烟。安装包 `release/StreamHarbor 1.0.0 site-adapters-setup.exe` 为 159,152,040 字节，SHA-256 `92E38FB21F6A41614DBE09A10DBE3B2FDBFB70C4AF6FA67B530AE637B3D5FBB2`；便携版 `release/StreamHarbor 1.0.0 site-adapters-portable.exe` 为 158,922,177 字节，SHA-256 `A80046B6FA3524A167118891F3AAA861A7D9E9ACD47C982A4C499444259A1C76`。安装器安装/卸载与便携自解压 UI 未单独验证。

## 2026-09-29 任意任务记录删除

下载队列和已完成页的每条记录均可删除。运行任务会先停止；任务、加密候选与剧集来源一同持久化移除；删除完成记录不删除最终视频文件。隔离测试覆盖取消、失败、暂停、待选资源、已完成及运行中任务，并核对重启后记录不恢复。36 项核心/站点测试、Vue 类型检查、开发程序和新打包目录 22 项 Electron 回归通过。原有“清除完成记录”仍用于批量清除完成项。

安装包 `release/StreamHarbor Setup 1.0.0.exe` 为 159,150,655 字节，SHA-256 `397FBA43AFC0A293F1BA7A6C6C21610876173951B73B63533091A02F0B008199`。旧同名便携文件被运行中客户端占用，新便携版输出为 `release/StreamHarbor 1.0.0 record-delete.exe`，143,917,313 字节，SHA-256 `340DD5FEB3844EE2679CE70C1E504F372ED8C44C3B6E9ABA611B7FDC5B59B9FD`。打包目录完整回归通过；新便携版自解压进程已启动，但 Playwright 未能取得窗口，本次未确认便携版 UI 全流程或安装器安装/卸载。

“资源站点”可保存名称、入口和独立登录会话。只有与现有 SOTVLA、大米星球或毒舌页面结构相同的网站可复用其适配器；其他站点需要增加搜索、分页、详情线路和播放链接解析，详见 `README.md`。手动粘贴播放链接使用通用媒体解析，无需片名搜索适配器。

## 2026-09-29 搜索与队列修复

36 项核心/站点测试、Vue 类型检查与前端/主进程构建通过。开发程序及新打包目录 `release/win-unpacked/StreamHarbor.exe` 均通过 19 项 Electron 回归，覆盖单站勾选搜索、剧集在对应结果下方展开、切换菜单后结果保留、最新任务置顶及重启排序、仅清除完成记录而保留取消/失败/暂停记录。两张 SOTVLA 封面通过站点会话读取成功；`年会不能停2` 搜索仅保留 2 条同名结果。

用户指定的 `https://www.sotvla3.cc/play.php?api_id=11&vod_id=69899&src=0&ep=0` 在当前 Electron 中可直接解析为 HLS；直接粘贴并加入任务，以及从搜索结果批量下载，两条路径均已取得第 1/2520 个分片。未进行整集及最终 MP4 校验。同片名 `api_id=9&vod_id=83515` 的详情页当前无可用剧集。现场记录为 `artifacts/site-acceptance-sotvla-api11-direct.json`、`artifacts/site-acceptance-sotvla-api11-segment.json`、`artifacts/site-acceptance-sotvla-api11.json` 与 `artifacts/site-acceptance-sotvla-api9.json`。

安装包 `release/StreamHarbor Setup 1.0.0.exe`：159,149,827 字节，SHA-256 `D378D4CD4A329A541D830CDE197DA4D17DFD7F66D852888A36FA984695DFD4FF`。便携版 `release/StreamHarbor 1.0.0.exe`：158,919,929 字节，SHA-256 `AAA19F6EAF0FDAD5B773E34CE0D5DB748C0B87D4EB2809F31B9C9FED86D6582B`。回归运行的是对应打包目录；安装器安装/卸载和便携自解压启动未单独验证。

## 2026-09-29 搜索发现与批量下载

本轮新增的 Windows 搜索、站点管理和批量下载流程已在隔离 Electron 数据目录验证。35 项核心及站点解析测试通过；开发构建和打包程序 19 项冒烟流程通过，涵盖站点搜索/详情、逐集延迟解析、重复提交拦截、多候选等待选择、原手动 URL 下载和完成记录恢复/清除。人工访问窗口取得的 Cookie 可供后续搜索复用，外部窗口没有应用 preload；批量任务的嵌套播放器 Referer 也通过隔离站点验证。`artifacts/smoke-results.json`、`artifacts/search-ui.png` 与 `artifacts/sites-ui.png` 保存了本地流程证据。
打包程序的任务记录检查还确认剧集播放入口与媒体地址未以明文写入 `state.json`；站点配置的导出只含站点字段。安装包 `release/StreamHarbor Setup 1.0.0.exe` 为 159,149,025 字节，SHA-256 `9bf1c6e89afae72ada053f886995e33cc8153b068f89c80016bd8c207baa0e47`；便携版 `release/StreamHarbor 1.0.0.exe` 为 158,919,162 字节，SHA-256 `83c5e705f9e0d275155552bd0b1b0b6da3a3154cbb09c709619fb887dd48b5d4`。打包目录 `win-unpacked/StreamHarbor.exe` 已运行完整冒烟，安装器安装/卸载与便携自解压启动未单独执行。

| 站点 | 搜索与分页 | 详情/线路 | 播放媒体解析 | 整集下载与校验 |
| --- | --- | --- | --- | --- |
| SOTVLA | Electron 会话成功；前两页各 16 条且资源 ID 不同 | `仙逆` 多个独立来源各 1 条线路、160 集 | `api_id=20` 首集进入 HLS 下载；另两来源也可解析 | `api_id=20` 第 01 集完成 385/385 分片和应用深度媒体校验；439,969,480 字节，SHA-256 `be7c6feaf9fb59a8fbc3b51eeb17e93951eb3ec7c29acf5ac8440443c675bc02`。`api_id=1/15` 起始 HTTP 404 |
| 大米星球 | Electron 会话成功；前两页各 16 条且资源 ID 不同 | `仙逆` 首条结果 20 条线路，分别保留剧集顺序 | 首集先出现多个候选，选择后进入 HLS 下载 | 第 01 集完成 779/779 分片和应用深度媒体校验；323,664,128 字节，SHA-256 `a19df18c0f70ccd2b7c53222b9356766b02281f299e188f6bfbf9e628f797de4` |
| 毒舌 | 原生 Electron 会话调用适配器，前两页各 18 条且资源 ID 不同；带 Playwright 调试连接时站点要求人工验证 | `仙逆` 首条结果 22 条线路，保留各线路独立剧集顺序 | 首条线路首集发现 HLS 候选；BD 线路未发现候选 | 首条线路第 1 集使用同一解析器与下载核心完成下载和深度媒体校验；431,404,811 字节，SHA-256 `85822945121c60d08910da0db41a6123c79e6ca063d53716325c7adeba4abdc4` |

真实站点记录见 `artifacts/site-acceptance.json`、`artifacts/site-acceptance-sotvla-alternate.json`、`artifacts/site-acceptance-sotvla-api20.json`、`artifacts/dushe-native-probe.json` 与 `artifacts/dushe-native-probe-bd.json`。三站成品位于隔离临时目录，在记录文件大小与哈希后清理。SOTVLA 部分来源失效，不代表同站全部来源失效。毒舌的搜索、详情和整片下载通过无调试连接的原生 Electron 会话；带 Playwright 调试连接的访问仍显示验证页，因此不把该路径记为通过。

日期：2026-09-08。环境：当前 Windows x64 开发机。测试资源由 FFmpeg 生成，不使用第三方视频作为可控样例。

## 核心测试：15 / 15 通过

原始结果见 `artifacts/core-tests.txt`。

- MP4 Range 与单连接回退，输出解码帧与源视频一致。
- MP4 暂停/恢复，已完成区间哈希校验。
- HLS TS、临时 HTTP 503 重试、字节范围。
- AES-128 显式/隐式 IV、密钥轮换；同 URI 的新密钥声明使用独立缓存周期。
- 未加密初始化片段不会错误使用后续媒体分片的密钥。
- fMP4 初始化片段和独立音轨；测试视频音画起始时间差小于 150 ms。
- 密钥不可用、直播列表、未支持加密方式明确失败。
- Cookie 域/路径边界与跨源授权头隔离。
- 非法文件名和错误 Range 响应。
- HLS 暂停恢复、同名输出不覆盖、资源变更保留恢复数据。
- 输出目录错误和手动 HTTP 代理传输。

输出样例执行完整解码并比较视频帧哈希；不是仅检查文件存在。

## 桌面流程

开发运行通过 10 项检查：工具检测、静态解析界面、独立进程下载与深度校验、隐藏 Chromium 动态发现、跨站 iframe 来源校验与无后缀媒体/统计接口排除、主播放列表清晰度、解析取消、界面无运行异常、敏感 URL 不以明文写入任务记录、完成任务重启恢复。

截图：`artifacts/desktop.png`。自动化记录：`artifacts/smoke-results.json`。

## 真实网页样本

| 样本 | 普通 HTTP 检查 | 浏览器复测 | 已验证下载 |
| --- | --- | --- | --- |
| dushe3 指定页面 | HTTP 850 | 解析成功：HLS | 否 |
| juzong01 指定页面 | HTTP 200，有 iframe，无直接 M3U8 字面量 | 解析成功：MP4 | 否 |
| time1080 指定页面 | HTTP 200，有 iframe，无直接 M3U8 字面量 | 解析成功：HLS | 否 |

原始记录：`artifacts/site-probes.json`、`artifacts/browser-site-probes.json`。抓取限制、网络问题与网站不支持不能等同；这三个指定页面已验证解析与媒体响应，尚未验证整片下载。未对其余成人站点做专门验证或适配。

## 未验证项与交付限制

- `release/win-unpacked/StreamHarbor.exe` 已单独运行并通过同样的 10 项桌面流程（0.1.1），证明随包 FFmpeg/FFprobe、ASAR 内下载进程和界面能协同运行。未在干净 Windows 虚拟机执行安装器安装/卸载，便携自解压启动尚未单独验收。
- 未模拟磁盘真正写满、突然断电、长达数小时的视频、复杂时间戳断点或大量任务压力；已处理相关操作错误，但不能声称这些场景全部实测通过。
- 未对真实认证 HTTP 代理、HTTPS CONNECT、SOCKS5、复杂系统 PAC 做端到端验收；手动 HTTP 代理已通过可控测试。
- 快速检测与起始时间测试不证明所有来源全片音画同步。遇到复杂播放列表须结合深度校验与实际播放。
- 转码/MKV 选择已实现，但首轮自动化以无损 MP4 为主；未验证所有输入编码组合。
- 未签名个人使用构建。源码与二进制版本锁定，不保证第三方网站未来变化后的兼容性。



## 0.1.2 完成记录清除
类型检查及 12 项开发桌面回归通过。新增按钮点击、文件逐字节保留、未完成记录保留、空列表重复清除、清除结果重启持久化验证。
打包后的 0.1.2 程序亦通过全部 12 项检查。

## 2026-10-08 蜘蛛网图标发布

- `release/spiderweb-20261008/StreamHarbor-1.0.0-spiderweb-setup.exe` 与 `StreamHarbor-1.0.0-spiderweb-portable.exe` 已构建；当前源码包含之前的 Meta 与 Myui 搜索修复。
- Windows ICO 包含 16/24/32/48/64/128/256 七尺寸；成品主 EXE、安装包和便携包中七层图标的 SHA256 均与源 ICO 对应层一致。
- 独立数据目录启动打包版 Electron，页面品牌 PNG 解码为 256×256、显示为36×36，媒体工具就绪，无页面错误；预览 `artifacts/spiderweb-desktop-preview.png`。
- 类型检查与构建通过。此次验证针对图标及应用启动，没有重复网络/视频下载验收。
- 详情及安装包哈希在 `artifacts/spiderweb-icon-validation.json`；发布目录含 `SHA256SUMS.txt` 与带图标/生成原图的源码 ZIP。
