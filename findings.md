# Findings

## 2026-09-29 AdRules 广告过滤
- 用户指定的 `AdRules.txt` 当前在成品客户端下载后为 5,346,117 字节（HTTP 传输层内容长度曾报约 1.67 MB），首行为 `[Adblock Plus 2.0]`，声明约 137333 条规则，包含网络规则与 `##` 页面元素规则；它不是简单域名黑名单。
- Ghostery Electron 集成对页面元素规则使用全局 IPC handler，两个独立搜索 session 会重复注册。两个搜索引擎改用同一个 `persist:web-search` 会话；资源站点和下载解析仍各用自己的会话，过滤器只绑定搜索会话。
- 规则仓库声明 Adblocker/uBlock/AdGuard 兼容；Ghostery 的 Electron 库提供解析列表、会话网络拦截和页面规则注入接口。
- 每次启动先解析本地成功缓存，再后台下载新版本；首次无缓存时等待至多 20 秒更新，失败仍可打开搜索窗口但界面说明广告规则不可用。更新成功才覆盖缓存。应用内模拟 503 证明缓存继续拦截脚本请求并隐藏广告元素，成品客户端已成功获取用户指定的真实规则地址。

## 2026-09-29 内置网页搜索窗口
- 现有 Google/DuckDuckGo 按钮经 `open-web-search` 调用 `shell.openExternal`，与“资源站点→访问”的 `BrowserWindow` 路径不同。
- 搜索引擎若直接加载到 BrowserWindow，没有地址栏；为完成“打开结果并复制链接”，窗口需提供显式复制当前页面网址入口，并兼顾右键链接复制。
- 两个引擎已使用独立 `persist:web-search-*` Electron 会话；窗口仅加载网页，无应用 preload。菜单提供当前网址复制、前进、后退、刷新，右键菜单可复制结果链接。
- Electron 自动化实际打开两个内置窗口并通过 `sendInputEvent` 验证 Ctrl+L 将当前 HTTPS 页面网址写入剪贴板。Playwright 页面的键盘模拟在窗口导航期间未触发快捷键，因此验证改在主进程发送原生输入事件。

## 2026-09-29 手动网页搜索需求
- 当前 LibVio/Stui 存在于默认站点、适配器类型、页面解析和旧配置。旧 `sites.json` 需迁移，不能因类型被删而整体读取失败。
- 搜索发现有独立跨站搜索输入；Google 和 DuckDuckGo 用系统默认浏览器打开搜索页，可直接使用浏览器地址栏复制目标网页链接，再粘贴到下载工作台。
- 下载工作台现有粘贴解析流程无需更改；搜索引擎不应伪装成自动解析资源站点。
- `catalogVersion: 4` 删除 LibVio 旧条目；其他使用 Stui 的自定义站点保留并改为 `none`。旧 Pianku 迁移仍有效。
- Google 与 DuckDuckGo 使用固定 HTTPS 入口和编码后的 `q` 参数，输入为空时打开首页；主进程只接受这两个引擎及不超过 200 字符的内容。

## 2026-09-29 任意任务记录删除
- 当前 `clear-completed` 只清除完成记录；每条任务没有删除入口。运行中的 worker、剧集解析器和 AUTH 刷新需在删记录前停止，防止后台流程重新写入状态。
- 已完成的视频是 `task.output` 指向的最终文件；临时分片使用 `<下载目录>/.streamharbor/<UUID>`。删除记录可清理临时目录而不触碰最终文件。
- 站点配置的 `adapter` 目前只有 `sotvla`、`dmxq`、`dushe`、`none`，普通新增站点并不会自动具备片名搜索和剧集提取规则。
- 逐条删除将运行中的 worker 停止后再移除记录；解析中与地址刷新中的任务先标记取消，防止后台重新入队。删除时同步持久化任务、加密候选和剧集来源，失败则恢复记录。最终视频文件不删除，临时分片清理失败会提示。
- 新便携版因旧同名文件被客户端占用而改名生成。打包目录 19 项回归通过；直接启动新便携版时自解压进程出现，但 Playwright 未取得窗口，不能将其记为便携版 UI 全流程通过。

## 2026-09-29 用户截图问题
- 搜索页由 App.vue 的 `v-if` 挂载，切换菜单即卸载且清空内存状态。详情组件位于站点列表上方。
- SearchView 将 Vue 响应式 `scope.value` 数组直接交给 IPC，单站勾选会触发 `An object could not be cloned`。
- 三个站点的封面原始字段未统一解析为绝对地址；页面直接用 `no-referrer` 显示远程图片。
- `views()` 直接用 Map 插入顺序；清除完成记录的主进程谓词已严格限制为 `state === 'complete'`。
- 既有真实站点记录证明 SOTVLA `api_id=1/15` 媒体起始 HTTP 404，`api_id=20` 已整集下载成功；须区分来源问题和整站失效。
- 用户指定 `api_id=11&vod_id=69899&src=0&ep=0`：当前 Electron 直接解析为 HLS，直接粘贴下载与搜索结果批量路径均已取得第 1/2520 个分片；未完成整集或 MP4 校验。同片名 `api_id=9&vod_id=83515` 当前详情页没有可用剧集。
- 两张 SOTVLA 封面经站点会话读取成功，约 63 KB；`年会不能停2` 的相关性过滤后只保留 2 条同名结果，第二页返回 0 条。
- 主进程清除完成记录原本已只选择 `complete`；新增回归证明取消和失败记录在清理及重启后保留。失败状态过去在重启时被重置为暂停，本轮已保持失败状态。

## Windows 搜索发现（2026-09-29）
- 现有 Windows 主进程在 `windows/src/main/main.ts` 管理任务及 IPC，`resolver.ts` 为每次解析创建临时会话，并在结束时清理。站点会话复用必须调整此生命周期和网络监听器。
- 原界面 `App.vue` 仅有下载、已完成和设置；新搜索与站点管理可作为独立导航页加入。已有任务安全存储在 `state.json` 的加密字段，站点配置应单独存盘。
- 开发计划提供 SOTVLA、大米星球详情链接；通用 web 读取这些页面失败，后续以 Electron 会话或实际网络响应核对结构。
- Python 实时请求 SOTVLA 详情 HTTP 200，确认 `play-source-tab[data-src]`、`[data-src-panel]` 与 `play-ep-pill`；首页搜索表单为 `/search.php?q=`，结果标题链接为 `.sr-title`，资源身份同时包含 `api_id` 与 `vod_id`。大米星球直连返回 403 `Disallow: /?*`；普通 curl 在本机 TLS 证书层失败，不能由此判断 Electron 会话结果。
- Electron 站点会话实测 SOTVLA 与大米星球前两页搜索不同结果、详情线路和剧集结构。大米星球 `仙逆` 第 01 集完成 779/779 HLS 分片、深度媒体校验，输出 323,664,128 字节，SHA-256 `a19df18c0f70ccd2b7c53222b9356766b02281f299e188f6bfbf9e628f797de4`。SOTVLA `api_id=20` 第 01 集完成 385/385 分片、深度校验，输出 439,969,480 字节，SHA-256 `be7c6feaf9fb59a8fbc3b51eeb17e93951eb3ec7c29acf5ac8440443c675bc02`；`api_id=1/15` 两来源起始 HTTP 404。
- 毒舌原生 Electron 窗口进入重定向后的 `dushe1.app`，搜索表单为 `/search`，参数 `k` 与隐藏 `t`；结果卡片为 `a.search-result-item`，分页 `page`；详情页 `.source-item` 与 `.episode-list` 按序一一对应，播放页 `/play/<id>.html`。原生会话实测前两页各 18 条、首条 22 条线路；首条线路首集经同一解析器与下载核心完成完整下载和深度校验，输出 431,404,811 字节，SHA-256 `85822945121c60d08910da0db41a6123c79e6ca063d53716325c7adeba4abdc4`。带 Playwright 调试连接的应用会话仍遇站点验证，不能把该路径算通过。
- 打包程序搜索详情界面首次因 Vue 响应式对象经 IPC 无法克隆而失败，改为传普通对象后通过；明文任务记录回归首次发现多候选 `source` 泄露播放页地址，改为站点名后通过。

## 仓库更名与双端拆分（2026-09-28）
- 当前本地目录不是 Git 工作区；上一轮通过 GitHub 连接器将完整源码上传到私有仓库 `gaopan513/ios-videoDownload`。迁移须核对远端 `main`，并保持私有可见性。
- iOS 构建工作流依赖原 `mobile/` 与根 `scripts/`；桌面构建脚本以当前工作目录为项目根。拆分后两端脚本应各自从其子目录运行，根目录保留仓库级工作流与总览。
- 当前两端源码、依赖缓存和脚本已拆分；旧 `release/` 与 `.tools/` 留在本地根目录作为历史产物，不进入 GitHub。新版本输出分别写入 `ios/release/` 和 `windows/release/`。
- 本地复核：Windows 30 项测试、主进程与前端构建、类型检查通过；iOS 解析 10 项测试、类型/前端构建、14 个 Swift 语法树、14 个夹具哈希、分段算术通过。两端源码归档分别通过 ZIP 校验。Swift 编译仍需云端 Xcode。
- GitHub 仓库保持同一 ID `1362034044` 与私有可见性，更名后地址为 `gaopan513/videoDownload`。`main` 0a3494a 的根目录可见 `ios/` 与 `windows/`；8 个代表性远端文件的 Git blob SHA 与本地一致。
- 新路径的 Actions run 36446663138 已通过 checkout、脚本换行、Node 设置、前端/解析与 Swift Core 测试；媒体库因缓存键路径变化正在重新构建。
- run 36446663138 最终 success，原生测试与 iPhone IPA 归档步骤通过。`StreamHarbor-iOS-prototype` artifact ID 10981395126，26,631,319 字节，GitHub digest `sha256:52a5968ff3ff739a5c7f399a5d4749c9f9aa9d5cc8926efdc602abff0cc84447`，对应源码提交 0a3494a。构建成功不等于真机目标站整片下载通过。


## 0.2.2(9) 上传构建过程与检查器盲区（2026-09-11）
- 三次云端失败、一次成功的完整教训：本地 tree-sitter 语法检查通过 ≠ Swift 编译通过。本轮暴露三类本地不可见错误：同类 static 成员在实例上下文必须带类型前缀；不存在的方法名（expandDetected 为笔误）；捕获列表捕获的是 @MainActor 属性的引用，闭包体内读取仍报隔离错误——必须在闭包外把值拷贝为普通局部量。
- 缓解：新增脚本化审计（正则收集 Resolver.X 引用与成员定义比对、裸 static 调用扫描、addTask 闭包体隔离属性扫描）；这些规则已可复用，但仍是启发式，最终以 Xcode 为准。
- 成功构建证据：22+16 测试 0 失败；IPA 哈希与构建内清单一致；arm64/版本/bundle 检查通过。

## 0.2.2(9) 候选垃圾来源证据（2026-09-11）
- 垃圾候选的三个来源：① 资源时间线扫描会把统计 SDK 的 .mp4/.m3u8 探测 URL 也报为媒体；② 广告片段（片头/水印/logo）与正片共用 CDN；③ 同一文件不同签名 token（?verify=...）被当作不同候选。
- 处理原则：不过白名单站点，只做通用启发式（主机类别 + 路径关键词 + 来源可信度分级）；播放器 <video> 元素与程序化网络请求是强证据，被动扫描是弱证据。零捕获行为不受影响。
- 已知局限：路径关键词过滤可能在正片文件名含 intro/outro 等词时误杀（罕见）；origin 分级依赖页面自身行为，若站点把正片藏进非标准加载方式，弱证据来源仍兜底（不会被过滤掉，只是排后）。

## 0.2.2(8) 解析性能瓶颈证据（2026-09-11）
- 串行展开是解析慢的主因之一：Resolver.done() 此前对 discovered.prefix(12) 逐个 await expand()，每个含至少 1-2 次网络往返；任何一个 45s 超时的主机都会挡住后面全部候选（最坏 12×45s）。改为 4 路并发后最坏约 3×20s。
- 逐字节读取放大延迟：HTTP.read 用 AsyncBytes 逐字节 for-await，每个字节一次挂起调度；播放列表/密钥/AES 样本都是小请求，开销占比高。Content-Length 已知时一次 data(for:) 读完。
- 本地检查器局限（记录为事实）：tree-sitter-swift 0.7.3 无法解析 withTaskGroup(of: (Int,Result<[T],Error>).self) 的 Result 泛型元组载荷，报假 ERROR；云端 Swift 编译器无此问题。为保持本地检查可信，载荷改用具名 struct Expansion。此局限不影响 Xcode 构建。
- 预期收益边界：并行化只加快「发现→候选列表」阶段；单个 HLS 列表请求本身的 RTT 不变。下载吞吐仍由 0.2.2(7) 的分段/会话策略决定，需真机 A/B。

## 0.2.2(7) 云构建验证结果（2026-09-11）
- 上传边界：只传 iOS 相关 17 文件；桌面版根 README 未覆盖远端 iOS 专用 README（用户选择）。Windows 本地文件为 CRLF，按 .gitattributes 以 LF 上传；此前一次构建失败就是脚本残留 CR，故上传前统一处理。
- 首次构建在 XcodeGen 克隆步骤报 runner DNS 失败（Could not resolve host: github.com），与提交内容无关，失败步骤与源码编译无关（FFmpeg 已构建成功）；rerun --failed 后整体 success。
- 云端测试证据：HarborCorePackageTests 22 项（DownloadSchedulingTests 9 + HLSTests 13）、HarborNativeTests 16 项，全部 0 失败；新增的 3 项 MP4 分段回归在云端通过，说明分段切分边界/覆盖/上限逻辑在 Apple 工具链下与本地 Node 复算一致。
- IPA：7,345,997 字节，arm64（cputype 0x0100000c）、0.2.2(7)、最低 iOS 17.0；内嵌 FFmpeg 7.1.1 + dav1d 1.5.1（VideoToolbox H.264 / FFmpeg AAC）；仓库脚本 check-ios-bundle.py 通过。说明：应用主二进制包含 FFmpeg 静态库，未用动态嵌入框架。
- 仍未验证：iPhone 上分段 MP4 是否真比整文件快（这是本轮唯一未经真机证明的性能假设），以及三站整片链路。

## 0.2.2 下载提速证据与 gaze 结案（2026-09-11）
- gaze（用户决定不再投入）：用真实 Chrome + CDP 移动 UA 复现。验证页（cap-widget）点击后可达播放器页；播放器请求 `data:application/vnd.apple.mpegurl;base64,...`（`currentSource_` 为该 data URL）并播放 `blob:` 的 MSE，视频 `readyState=4`、`duration≈3388.6s`，但整页 65 个请求中可下载媒体地址为 0。播放器源码把 `options_.sources` 里每集地址存为十六进制密文，靠页面 `[data-player-config]` 的 `playerMid`/`playerCredentialName`/`playerCredentialValue` 与站点内 `DimGive` 现场解密，分片名也是站点自定义编码。结论：不是通用解析缺陷，而是单站定制链路；按用户指示暂缓，不计入三站验收。
- MP4 现有实现是单个 `URLSessionDownloadTask` 整文件下载，因此只用 1 条连接、`httpMaximumConnectionsPerHost=6` 的其余名额闲置；这是“进度基本不动”之外、纯客户端可改的确定性瓶颈。桌面侧对 kanju 同批分片实测（`p3.wikjdd.cn`，公开无 Cookie，三次重复）显示并发提升后总吞吐明显上升而单请求速率下降，说明单连接受限、多连接聚合有效；但该结论来自桌面网络与固定签名分片，**不能**直接外推到 iPhone。
- 提速实现边界：
  - 分段仅在 1 字节探测返回 206 且 `Content-Range` 给出总长度、且总长 ≥16 MiB 时启用；否则保持整文件单请求（老行为）。段长 8 MiB、上限 4096 段（即 ≤32 GiB）。
  - 服务器未按范围返回时，`degradeMP4` 用当前分片计划替换为整文件单段并清理旧分片；旧回调靠 `planGeneration` 与传输对象身份双重丢弃，不会污染新方案。
  - 分段适用前台会话（可整体重来），整文件 MP4 仍留在后台会话，避免丢失大文件部分进度；该区分由 `restartable(_:)` 统一，`setForeground` 与调度使用同一判据。
  - 任务索引写入改为合并且移出主线程；进入后台与释放系统后台完成回调前同步落盘，避免提交前被挂起而丢状态。
  - 启动恢复的全分片哈希校验移出主线程；失败仍置任务为失败，不静默接受损坏分片。
- 证据文件：`artifacts/gaze-verification-findings.json`（gaze 现场结论）、`artifacts/ios-throughput-ordering.json`（并发排序依据，含局限）；源码包 `release/ios-source/StreamHarbor-iOS-prototype-source.zip` SHA256 `7ba4dafc3d6549758d57b33a66cb6eafbfb0861ded1ab5de197e3757de9dc9e5`，版本 0.2.2(7)。
- 未验证项：Xcode 类型检查、Swift 核心/原生 XCTest、iPhone 上的分段 A/B 提速、以及分段对特定 CDN 是否反而更慢。不能用 Windows 结果代替真机结论。

## 0.2.2 本地修复与证据（2026-09-11）
- juok：公开列表 HTTP200，693 片，第 654 片 EXTINF:0；请求返回 HTTP200、15,416 字节。FFprobe 识别 H.264/AAC，视频 0.12 秒，容器 0.198633 秒。根因是客户端 `value > 0` 拒绝零时长；改为接受非负有限值，保留分片、序号、AES IV。证据 `artifacts/current-sites-media.json`、`artifacts/current-sites-segments.json`。
- kanju：列表 HTTP200，236 片，BYTERANGE 跳过每个 PNG 资源前 120 字节。前三片无 Cookie 请求均 HTTP206，Content-Range/长度正确，TS 数据，1.3–2.0 秒完成。不能由电脑端请求速度推断 iPhone 瓶颈；没有证明服务器失效或 Range 被忽略。
- iOS 前台此前仍只使用后台 URLSession。本轮加入 HLS 前台普通会话/后台系统会话交接，取消尚未完成片并以完整原 Range 重建，已完成和校验中分片保留；旧任务的晚到回调通过对象身份校验丢弃。整文件 MP4 不切换会话，以免丢失大文件部分进度。
- 前台 1 秒刷新接收速度与无字节等待状态；Range 长度作为已知进度分母；失败展示主机和 NSError code，不暴露签名 URL。速度为本次活动窗口的平均接收速度，不是整片实测提速。
- gaze：实时浏览器停在访问验证页。修复自动 25 秒到期/手动完成时零候选导致关闭页面、重新打开又丢失临时验证会话的行为；现保留当前页供用户验证/播放。同次应用内复用隔离的 nonPersistent 数据存储。尚未确认验证后该页的媒体捕获结果。
- Apple 官方说明后台任务受系统调度和唤醒限速，回到前台会重置该限速；这支持区分前后台的设计，不证明是本次 kanju 唯一根因：https://developer.apple.com/documentation/foundation/downloading-files-in-the-background 。
- 合成零时长列表 Windows FFmpeg 6.1.1 对照：24 个输入视频包全部保留，输出 2.0 秒，完整解码退出 0。iOS FFmpeg 7.1.1 新增原生用例仍需 Xcode，不能用此对照代替。

## 本轮三站排查（2026-09-11，进行中）
- 实时内置浏览器：gaze 页面显示“访问验证 / 点击以确认你是真人”，未进入播放器。验证操作已向用户请求确认；不能将此现象直接等同于手机现场。
- juok 已进入播放器，页面加载 cache.0567890.xyz:4433 的 HLS 列表及 data.video.iqiyi.com TS 分片；kanju 已播放《完美世界》，媒体列表主机 lf1.wikjdd.cn。后续采用无 Cookie 的公开媒体响应检查。
- Electron 沙箱 GPU 崩溃，独立目录重启后 debugger 初始化未返回；已切换内置浏览器取证，不把工具故障解释为网站不可用。

## 0.2.1 产物本地校验完成（2026-09-10）
- 已下载构建产物到 release/ios/0.2.1，提取IPA和配套材料。外层GitHub digest、内层IPA SHA256、双层ZIP完整性、0.2.1(5)/arm64及已删除的界面文案均核验通过，见verification.json。此前本地下载未完成状态已解除；实际站点与速度仍待真机。

## 0.2.1 云构建成功（2026-09-10，最新）
- main提交06c9eee9380e916cf1c8e83f76aa4f95b010d0ec；run 34478910873已success，用时4分58秒，18文件远程blob核验一致。
- 日志确认6 JS、17核心、13原生测试通过，包含5项下载调度回归及fMP4三输出回归；TEST SUCCEEDED / ARCHIVE SUCCEEDED。
- GitHub产物ID10152892494，26377138字节，digest c83e985695e6392fce9ab8f2a37eddb7211df65eb24f1823bf659bf470ac5a7b。
- 版本源码0.2.1(5)；云端arm64归档和bundle检查通过。本地下载链接出现TLS失败/HTTP403，未完成本地IPA内容与双层哈希核验；浏览器已点击GitHub产物下载，未确认落盘位置，下载管理页被浏览器策略拦截后未绕过。
- 可在https://github.com/gaopan513/ios-videoDownload/actions/runs/34478910873 下载StreamHarbor-iOS-prototype。仍待iPhone目标页复测与下载耗时对比，不把回归通过当作站点验收。

## 0.2.1 上传与构建（2026-09-10）
- 用户已恢复授权；18个文件上传私有仓库 gaopan513/ios-videoDownload 的 main，提交06c9eee9380e916cf1c8e83f76aa4f95b010d0ec，远程blob哈希逐一核验一致。
- 自动审批首次以目的地归属未核实拒绝；随后实时核验登录账号与私有仓库所有者同为gaopan513、拥有admin/push权限，重试获准。
- 已启动run 34478910873（workflow_dispatch，提交06c9eee），等待云端核心/原生测试和0.2.1(5) IPA。

## 下载性能优化实现边界（2026-09-10）
- 长HLS此前每完成一片典型路径会4次加密写入完整任务索引；改为完成校验时1次，另仅在任务状态变化时保存。仍保留完整计划先持久化、分片哈希和恢复校验。
- 批次24/低水位8/每主机6连接是保守实现参数，不是实测最优值；HTTP/2实际并发由URLSession/服务器协商，不能把提交任务数当作固定连接数。
- 完成分片哈希在串行utility队列执行，避免阻塞MainActor；队列中的校验工作也计入已占用名额，避免下载过快造成无限积压。
- 分片进度原本只在整片完成时跳动，改为已完成片+当前片字节比例（哈希提交前最多0.99）；这改善显示连续性，不等于网络吞吐率已提高。
- 真机必须同链接、同网络比较总下载时间，并验证暂停/继续、取消后重建、后台20分钟和断网恢复。当前没有新设备测速证据。

## iOS 下载性能初查（2026-09-10）
- DownloadEngine 使用单一后台 URLSession、每主机4连接，但每任务最多只提交4个分片；Apple 官方文档建议在同一后台会话一次提交较多任务，以减少后台唤醒追加任务的速率限制。
- 每片完成时 didFinish/persist、didComplete/persist、schedule/每新任务persist、schedule末尾persist，典型情况下同一份完整加密任务索引写4次。哈希和序列化都在 MainActor。
- didWriteData 每次扫描所有分片计算完成数，再映射所有任务发布到 WebView；HLS长片大量小回调会放大此开销。尚无用户设备测速，不把静态缺陷归因为唯一瓶颈。
- 来源：https://developer.apple.com/documentation/foundation/downloading-files-in-the-background

## 本轮确认：本地分片后缀与 FFmpeg 7.1.1 不兼容（2026-09-10）
- 当前代码 `DownloadEngine.process()` 将已校验/解密的 HLS 初始化片和媒体片命名为 `.plain`；封装与转码均只设 `allowed_extensions=ALL`。
- 已下载并在内存中核验构建脚本固定 SHA256 的 FFmpeg 7.1.1 源码：`hls.c:test_segment()` 默认启用 `extension_picky`，即使 allowed_extensions 为 ALL，仍检查后缀与探测出的 demuxer 格式是否匹配；`.plain` 不匹配。证据：`artifacts/ios-local-hls-extension-check.json`。这是明确的本地输入兼容性缺陷，与三模式共同失败相符；尚未取得此页 iPhone 底层日志，不宣称已完全解决真机故障。
- 修复两处原生本地读取入口及 ffconcat 子列表传参 `extension_picky=0`；保留 file-only 协议限制，适用于 App 生成的本地列表。
- 新增纯合成 fMP4 初始化片+两媒体片夹具，原生回归使用生产同款 `.plain` 文件名，覆盖 MP4/MKV/转码、音视频存在、时长和深度解码；旧不连续 TS 回归也改为 `.plain`，覆盖 concat 子列表。
- 本轮未重新请求目标站全部分片；先前站点证据仅为两路列表与各前三片公开响应，不等于完整性验收。

## mrds66 媒体处理失败初步定位（2026-09-10）
- 用户确认 iOS 0.2.0 新包下载 `https://www.mrds66.com/archives/192363/` 时，MP4、MKV、转码三种输出方式均提示“媒体处理失败，请检查分片完整性或更换输出方式”。
- 此文案精确来自 `mobile/ios/Native/Media.swift`：除编码不兼容（-2）和 VideoToolbox 启动失败（-3）外，所有原生媒体处理错误都被折叠为该句。因此它不能证明分片缺失，也不能区分 HLS 输入、封装或转码失败。
- 已完成的 Windows 桌面端实测与本次 iOS 故障无关，不作为任何结论。下一步必须用 iOS 链路的脱敏分片与原生处理证据定位。
- 排查脚本首次尝试将解析会话 Cookie 带到媒体主机被安全策略拒绝；已停止该做法，改为无 Cookie 的公开响应检查。
- 当前页面解析出两路完整 fMP4 VOD HLS：8 分片（总声明时长 47.167 秒）和 39 分片（总声明时长 229.367 秒）。两路均含 `EXT-X-MAP`、`ENDLIST`，不含 AES、`GAP`、`DISCONTINUITY` 或直播标记；每路前三个公开 m4s 分片均为 HTTP 200 且非空。脱敏证据：`artifacts/mrds66-diagnosis.json`。
- 三种输出在 `DownloadEngine.process()` 中共享“生成本地 HLS 播放列表（含 MAP）→ `NativeMedia.remux()` → `harbor_convert()`”入口；只有 MP4、MKV 和转码全部在该入口失败时才会显示用户所见通用文案。
- 当前原生测试覆盖 TS、独立音轨、时间轴不连续和普通容器编码矩阵，但未覆盖本地 fMP4 HLS 初始化片 (`EXT-X-MAP`) 端到端封装。现有证据将其列为最高优先级的缺口，而不是将服务器分片判为损坏。

## 0.2.0 编码对齐（2026-09-10，本轮）
- 已接入桌面 MP4 编码集合、MKV 无损保存、VideoToolbox H.264 / FFmpeg AAC 转码；贯通 UI、Bridge、加密任务状态、失败重试和导出。
- 旧记录按 MP4 恢复，重试更改输出格式先持久化再更新内存；已完成分片保留。新增时长检查，深度解码可选。
- FFmpeg 7.1.1 增补解码/封装/滤镜，dav1d 1.5.1 来源和 SHA 固定；重链接材料包含新依赖。
- 本地前端类型/生产构建、6 项 JS 回归、12 Swift 文件语法与夹具哈希检查通过。新增原生编码矩阵/转码、核心迁移/回滚测试待 Xcode，不记为已通过。
- run 34442498057 在媒体库构建阶段因 `set -u` 展开空 `MESON_SETUP` 数组失败；修复提交 ae2dc7e 改为首次构建与缓存重配置两条显式 Meson 调用。
- run 34443702921 成功：媒体库、XcodeGen、12 项核心和 12 项模拟器原生测试、iPhone arm64 归档及 IPA 上传均通过。artifact 与 IPA SHA-256、版本 0.2.0(4)、Payload/Web 资源和 arm64 Mach-O 已在本地复核。

## 0.1.2 修复证据（2026-09-10 最新）
- HLS 标记本身不足以修复 libavformat 读取后的 DTS 回退：重复2秒TS的直接HLS包 DTS 从3.316667回到1.4。改为按边界分组、声明 duration 的 ffconcat；合成48包时间戳单调且完整解码通过。
- 毒舌首个边界两侧真实TS在Windows封装为6.017959秒 H.264/AAC并完整解码通过。见 artifacts/dushe-boundary-validation.json，不代表整片成功。
- 拾光刚加载网页的相同 session 内，列表返回200、static.yximgs.com 前两片均404（artifacts/time-session-segments.json）。不同 Referer/Origin 的HTTP对照也404，不能靠猜头修复。现将服务器状态与阶段准确显示，并禁止预检已知404的任务入队。
- RFC8216 4.3.2.3/4.3.3.3用于核对边界标记与序号，不将 DISCONTINUITY-SEQUENCE 误判为缺失分片。

## 0.1.1 真机第二轮与实时复现（2026-09-10）
- 用户：毒舌发现 1 地址但拒绝会话密钥/缺失分片/时间轴；拾光识别 HLS 后下载 404。
- Chromium 实时读取毒舌播放列表 HTTP200，2812 分片，含 EXT-X-DISCONTINUITY、ENDLIST，无 SESSION-KEY/GAP。证据 artifacts/ios-hls-probe.json；原始列表保存在 .tools，不上传含签名 URL。
- 拾光候选播放列表复请求 HTTP404，仍在核查重定向/会话，不能直接判定源失效。
- 本轮沿用 planning-with-files；沙箱 Electron GPU 启动失败，正常权限运行成功。

## 0.1.1 云端证据（2026-09-09 最新）
- 用户提供 run 34354965766，API 核实 success 且 head_sha=d1755b0e4c7276ff5820896f28d6ed1515e7f1bb。
- 日志确认 6 JS + 7 核心 + 6 原生测试零失败，包含新增 WebKit 捕获和记录删除回归；TEST SUCCEEDED / ARCHIVE SUCCEEDED。
- 产物 ID 10105569792，ZIP SHA256 8213c70448135552eb2cf3528cc89ea44cfb2f85f181dcd1d7bdd4d45be0e483；本地下载与内层 IPA 哈希核验通过。IPA 0.1.1 (2) / arm64 / iOS17 / Web 删除接口齐全，证据 release/ios/0.1.1/verification.json。

## 上传与构建入口（2026-09-09 最新）
- 用户已明确授权修复源码上传；main 为 d1755b0e4c7276ff5820896f28d6ed1515e7f1bb，12 文件远程 blob 哈希核验一致。
- Chrome 控制超时，workflow_dispatch 工具缺失；尚无该提交云构建运行。此前上传审批拒绝已解除，当前阻塞仅为启动工作流入口。

## 本轮代码排查（2026-09-09）
- 用户补充：iPhone 17 / iOS 27 beta 6（用户自报）；提示找不到解析；打开网页识别后可以播放。故障集中在发现/过滤/交接链路，尚无逐站抓包，不认定单一根因。
- 代码缺陷：导航拒绝 about:blank/srcdoc 子帧，来自非 HTTP frame 的媒体消息被丢弃；无后缀 video.src 被过滤；XHR 仅在 load 后识别；HLS 展开异常被 try? 吞掉。
- 修复：放行空白子帧并回退来源页、请求发起即捕获、无后缀视频有限字节探测、报告发现数量及加载/媒体错误。保留 Cookie/UA 会话传递，未增加登录或手动 Cookie。
- 删除记录贯通 Vue/Bridge/原生，仅允许 complete/cancelled；先保存再更新内存，保留成品。修复异步恢复期间其他记录删除导致数组索引变化的问题。
- 本地 6 项 JS 捕获回归、Vue 类型检查/生产构建、12 Swift 文件语法树检查通过；新增 WKWebView srcdoc 实测与加密存储删除/失败回滚/重启/文件保留测试，尚待 macOS 执行。
- 浏览器打开 Actions 超时；连接器可读写源码但未提供 workflow_dispatch。Windows 无 Xcode，当前不能生成新版 IPA；三站真机仍待复测。
- create_tree 上传源码被自动审批拒绝（要求明确授权上传到 gaopan513/ios-videoDownload），未尝试绕过，远程 main 未改。

## 最新真机反馈与结论（2026-09-09）
- 用户明确反馈：构建已成功，已安装测试；给出的毒舌、剧踪、拾光三个校验站点都不能解析；下载记录没有删除功能。
- 证据边界：安装和解析失败来自用户真机反馈；尚未收到具体错误文本、机型/iOS 版本、自动解析或手动播放路径的区分。根因待定位，不能推断为站点不可用或某个 Cookie/Referer 问题。
- 云构建 run 34319138718 已由连接器核实 success，7 项核心与 4 项原生测试通过；IPA 双层哈希、ZIP、arm64、最低 iOS 17.0 和 Web 资源已核验。
- 构建/模拟器测试未覆盖三站真实 WKWebView 识别行为；Windows 历史解析成功不证明 iOS 支持。三站目前应记为“用户实测解析失败”，整片下载/导出/锁屏仍未通过验收。
- 记录删除原先排在第二阶段，现根据用户反馈提前进入原型修复。取消下载不能代替删除记录；实现需保证持久化和重启一致，默认保留成品文件。
- 排查范围：网页导航/加载错误、iframe 和媒体发现、自动等待结束、手动播放识别、候选过滤、会话交接；以上仅为检查方向，尚未确定故障点。

## iOS 原型实施历史（2026-09-09，早期阻塞已解除）
- 当前是 Windows，未发现 Xcode/Swift 命令；目录没有 Git remote。用户已指定 gaopan513/ios-videoDownload；早期 GitHub 连接返回 404，后续授权恢复并完成上传和构建。
- mobile 使用独立 npm 锁文件，避免影响桌面依赖。Capacitor JS/SwiftPM 固定 8.0.0。
- XcodeGen 固定 2.44.1；官方 runner 清单确认 macos-15 可选择 Xcode 26.3。FFmpeg 7.1.1 源码下载 SHA256 已独立计算并固定。
- Windows 三站历史证据只有解析成功；最新 iOS 首轮用户反馈三站均解析失败，第二样本及全流程验收未完成。
- esbuild 在当前沙箱读取父目录失败；经批准在沙箱外重试，15 项 Windows 核心测试和主进程构建通过。

- 初始目录为空，无现有技术栈或 AGENTS.md 约定。
- Node 可用；PATH 无 npm、FFmpeg。需定位/准备项目本地工具链。
- web 工具无法打开前三个用户样本，不能推断网站不可用。待执行普通 HTTP 验证。
- 架构：Electron + TypeScript + Vue 3 + Vite；后台解析使用独立隔离 Chromium 会话；下载通过 utilityProcess，FFmpeg 本地处理。
- UI 设计：浅雾蓝 #eef3f8、墨蓝 #19324a、海蓝 #176bba、青色 #258b87、白 #ffffff。Segoe UI/Microsoft YaHei 正文，Consolas 数字；左导航、中央任务工作台；分段进度条对应真实任务阶段，不做营销页。
- Electron 44 的 session.fetch 在本次环境中返回空 Response.url，需要手动跟踪重定向；下载前不能直接信任 response.url。
- Windows 本地 HLS 路径需统一正斜线，否则 FFprobe 无法解析相对分片路径。
- FFprobe-static 默认包里的二进制较旧；改用与 FFmpeg 同源同版本 6.1.1，哈希固定在 media-lock.json。
- 打包器默认重下载 Electron 会超时，配置 electronDist 复用已安装运行时。当前机器的 Node 网络工具需使用系统代理包装脚本，不能把网络下载失败当代码构建失败。

## 三站解析修复（2026-09-08）
- 普通网页直接走 Chromium 导航，毒舌 850 可由页面自身重新加载为 200；HTTP 预检会浪费预算。
- 跨站 Referer 直接写入 Electron fetch headers 会返回 ERR_BLOCKED_BY_CLIENT；使用 referrer/referrerPolicy 后三站媒体均验证成功。
- frame.executeJavaScript 需要独立等待上限，避免空 frame/导航阻塞网络发现循环。
- 仅匹配 URL pathname 的媒体后缀，避免统计接口 query 中的 .mp4 误判；无后缀视频按 Content-Type 识别。
- 最小 Range 探测改为单字节。真实复测：毒舌 HLS 11.3 秒、剧踪 MP4 6.6 秒、拾光 HLS 8.7 秒；尚未执行整片下载。
- 防盗链回归进一步确认：Electron 44 仅设置 referrer 字段并不会发送 Referer；最终必须保留 Referer header，同时显式设置 referrerPolicy。两个 IPv4 端口的嵌套播放器测试已验证服务端收到完整来源。
- 完成记录清除独立 IPC 经主窗口校验，只修改任务索引并持久化，不执行文件删除；清除期间按钮禁用，无完成记录时不可点击。
# 2026-09-29 五站适配探查

## 2026-09-29 本轮排查
- 截图中 LibVio 搜索有结果，但详情报“Stui 播放列表结构已变化”；当前解析仅匹配 `.playlist-panel .stui-content__playlist a[href*="/w/"]`。
- 搜索结果按配置列表固定排序；单站重试没有独立的可见进度与结果清理。
- 片库同时存在于默认站点、`pianku` 类型、旧配置迁移和持久化用户列表，移除须覆盖这些入口。
- 原生 Electron 复现“年会不能停！2”：LibVio `/detail/714893696.html` 只有 `.play-btn a[href="/w/714893696-1-1.html"]`，其余 `.playlist-panel` 均为网盘；保留多集列表解析，缺失时使用这条站内播放入口。
- 修复后原生 Electron 搜索返回 1 条，详情返回 1 条“在线播放”线路；同一播放页的媒体探针返回“未发现可下载的完整视频”。详情可打开与媒体可下载应分别陈述。
- 片库旧预置记录在 `catalogVersion: 3` 迁移时移除；其他使用旧 `pianku` 类型的自定义站点保留配置并改为 `none`，避免整个 `sites.json` 无法加载。

- 现有 Windows 站点适配器：SOTVLA 使用 `search.php/detail.php/play.php`，大米星球使用 `vodsearch/voddetail/vodplay`，毒舌使用带表单令牌的 `/search`、`/detail`、`/play`。其真实结构需要与新站逐一比对。
- 网页抓取工具只取得片库首页；LibVio、绿丝草、星河看、滴答高清分别出现工具不可访问或 403。这些结果不等于 Electron 会话不可访问，后续以原生 Electron 页面为准。
- 首轮原生 Electron 页面：LibVio 播放页可打开，搜索表单是 `/search/-------------.html?wd=`，剧集为 `/w/<片 ID>-<线路>-<集>.html`，有 `stui-player` 容器。
- 片库首页可打开，搜索表单是 `/vodsearch/-------------.html?wd=`；需要继续确认搜索结果的详情和线路模板是否与大米星球一致。
- 绿色影视播放页可打开，搜索表单是 `/search.php?searchword=`，剧集为 `/play/<片 ID>-<线路>-<集>.html`，`myui-player` 容器。
- 嘀嗒影视首页可打开，搜索表单也是 `/search/-------------.html?wd=`，详情链接为 `/detail/<片 ID>.html`，首页卡片使用 `myui-vodlist__thumb`。
- 星河看 `https://xhkan1.top/` 在原生 Electron 导航超时；网页抓取返回 403。尚无可靠模板证据，不据此归类。
- 第二轮原生 Electron 搜索/详情：LibVio 结果 `.stui-vodlist__box`、详情 `.playlist-panel` / `.stui-content__playlist`，线路剧集 `/w/<id>-<line>-<episode>.html`；需新建 `stui` 类。
- 绿色影视与嘀嗒影视都使用 `.myui-content__list` 组织剧集，链接分别为 `/play/<id>-0-0.html` 与 `/play/<id>-5-1.html` 等；可按 URL 中的线路编号通用分组。搜索与详情路由不同，应从站点表单和结果链接提取。
- 片库与大米星球都使用 `/vodsearch`、`/voddetail`、`/vodplay` 路由，但片库结果是 `.vod-grid .vod-item`、详情 `.play-source-section`，当前样本为空，仅有“播放”链接；不能直接沿用大米星球 `.module-*` 详情选择器。可共享 `/vodplay` 线路分组，同时给片库独立页面布局解析。
- LibVio 页面提示搜索间隔至少 5 秒；原生 Electron 搜索页等待 2 秒并在提示页等待后重试，可以再次取得 1 条结果、7 集详情和 MP4 候选。频繁探针访问时可能临时返回空页。
- 绿色影视的“下一页”链接可能存在但“尾页”为第 1 页；请求第 2 页会重复第 1 页，因此按尾页编号和结果 ID 去重。
- 媒体发现：LibVio 首集 1 个 MP4 候选，绿色影视首集 2 个 HLS 候选，嘀嗒首集 1 个 HLS 候选。片库两条同名搜索结果各有播放入口，但均无媒体候选；一次播放页导航超时。候选发现不是整集下载证明。
- 星河看原地址超时；用户给出的 `xhkan.cc` 是线路发布页，`xhkan2.top`/`xhkan3.top` 显示滑块验证。用户明确要求移除此站，最终预置列表不包含它。


## 2026-09-30 Chrome 扩展故障定位
- 扩展是独立 Vite/Vue Manifest V3 项目，MP4 原先在 popup 直接调用 downloads.download，未传递播放请求上下文。
- 下载 API 返回 ID 即报告完成，没有监测 complete/interrupted；WebM 也被强制命名为 MP4。
- 网络捕获按整条 URL 的 .mp4 字串分类，未排除 HTML/HTTP 错误；DOM 候选先到时网络候选被直接忽略。
- 截图反映 HTML 保存及 Chrome 提取失败；Referer 防盗链是待浏览器实测的原因，尚未确认真实站点返回内容。

## 2026-09-30 Chrome 扩展修复完成
- Chrome for Testing 154.0.8037.92 实测：downloads.download 直接传 Referer 报 Unsafe request header name；DNR 对扩展 fetch 生效，但原生下载请求仍未带 Referer。
- 最终方案：保留网络 Referer/Origin，session DNR 精确匹配资源且排除播放标签；后台 offscreen 文档获取完整 MP4/WebM，Blob 交给 Chrome 保存。原生保存 complete 才报告 100%，interrupted/HTML/网络中断报告失败，完成时清理规则和 Blob。
- 对捕获 URL 使用 pathname/MIME，排除 HTML/JSON 和 query 假媒体；Range 总大小使用 Content-Range，DOM 候选由网络信息补全。content script 独立 IIFE 打包。
- 6 组实际浏览器回归通过（浏览器内执行、Referer、完整字节、WebM、HTML 拒绝、popup 重开、网络中断）。使用受控二进制夹具，未作视频解码或真实 LibVio 整集验收。
- MP4/WebM 暂存完整文件占用内存；HLS 生命周期未改，仍需保持 popup 打开。用户重载扩展并刷新播放页后可获得新捕获上下文。

## 2026-09-30 完整性提示复查发现
- 错误来自 offscreen 读取结束后 received !== total；total 原先混用本次 Content-Length 与播放候选 size。
- 压缩响应 Content-Length 为编码后长度，fetch 读取为解码后字节；候选 size 只能用于进度估计，不能作为新响应的强校验值。
- 本次下载和 Range 预检都改为 cache:no-store，避免小范围响应污染缓存。严格长度校验只使用本次未编码响应的 Content-Length/完整 Content-Range；真实网络截断和不完整 206 仍失败。
- 截图同一 MP4 带不同 hash 重复出现，捕获键按实际请求 URL 去掉 hash 去重。
- 普通 HTTP 探针 v.livio.app 无法连接、旧 v.libhd.app 返回 Cloudflare 403，不能代替用户 Chrome 的响应证据。CUA 初始化报 assets 路径缺失，未能读取用户标签页；已请求实际链接。

## 2026-09-30 完整性复查最终证据
- 用户提供 https://v.libvio.app/2026/mj/8/Lanterns.S01/Lanterns.S01E01.mp4#t=1133.01 与 https://www.libvio.io/w/714893650-3-1.html。
- Chrome for Testing 154.0.8037.92 使用最终 extension/dist 完整获取并落盘：HTTP 200，Content-Encoding identity，声明/接收/保存均为 934277489 字节。
- FFprobe：H.264 1920x960、AAC，3388.635250 秒（约 56 分 29 秒）。报告 extension/browser-validation.json；未做全片深度解码，也未读取用户原 Chrome 失败请求。
- 8 组受控回归加 1 组真实视频验收通过，TypeScript/Vue 检查及 Vite 构建通过。压缩与 chunked 的误判路径已由受控浏览器验证；此次真实站点未返回压缩响应，不能把用户原失败直接认定为 gzip。
- cache:no-store 禁止 Range 预检/完整下载复用缓存；严格校验依据本次响应。原 Chrome 失败究竟由旧缓存还是旧长度来源触发，缺少当时响应证据；修正后该视频已完成实际验收。

## 2026-09-30 跨页面下载进度定位
- 后台任务已通过 storage.session 保存，popup 的 progressMap 也会读全部任务，但模板只遍历当前标签页 candidates。因此切换页面后任务仍运行但无卡片承载状态。
- 任务记录目前未保存标题/媒体地址等显示信息；将补入任务元数据并在 popup 顶部独立渲染跨页面任务。

## 2026-09-30 任务操作追加范围
- 用户追加暂停/继续/重试/取消需求。MP4/WebM 全局任务保存 UI 元数据、请求上下文与尝试 runId，独立于 tabCandidates。
- offscreen 为任务保留分段内存，暂停 AbortController；继续以 Range + If-Range 验证文件身份/完整范围，无法证明一致则重新下载；取消清理内存和 DNR/Blob，重试创建新尝试并隔离旧回调。
- 任务完成提供打开文件/显示文件夹/移除记录，失败/取消提供重试/移除。打开文件在 UI click 直接调用 chrome.downloads.open 保留 user gesture，增加 downloads.open 权限。
- 保存对话框不持有任务队列，其他任务可继续操作。移除记录保留本地文件。此次控制覆盖 MP4/WebM，HLS 原弹窗流程未迁移。
- 13 组 Chrome 浏览器回归初步通过：跨标签页 UI、暂停/继续 Range、取消/重试、失败传播、源文件改变和无校验标识时安全重下、记录移除保留文件。

## 2026-09-30 全局任务与控制最终验收
- 最终 Chrome for Testing 154.0.8037.92 共 14 组检查通过，报告 extension/browser-validation.json；受控操作报告 extension/browser-controls-validation.json。
- 用户 LibVio 视频实际点击暂停，暂停 1 秒进度不变；继续请求以 Range/If-Range 接续。最终 receivedBytes/savedBytes/expectedBytes 均为 934277489，FFprobe H.264 1920x960 + AAC、3388.635250 秒。
- 完成后按钮仅核对显示与 API/permissions；没有自动启动系统播放器或文件管理器。真实视频测试文件、隔离 profile 清理，临时 Chrome 运行时验收后删除。
- 初次尝试同一 apply_patch 对同一文件 Delete/Add 被工具拒绝，源码当时未改变；后用单次写入完成 offscreen 重构。

## 2026-09-30 弹窗恢复复查
- 用户反馈切换标签后全局进度仍消失且原页状态也消失；不能把前轮普通扩展页面重开测试当作真实工具栏 popup 已验证。
- 当前任务 storage.session，界面仅依赖 runtime 消息且失败只写 console。后台完成依赖长时 sendMessage 的返回 Promise，worker 被销毁后原回调无法恢复。
- 将任务迁移到 storage.local，并用 offscreen 完成事件更新；popup 先直接读持久化状态，再后台同步，显示版本与同步错误。
- CUA/node_repl 均因 kernel assets 路径缺失无法初始化，暂不能读取用户真实 Chrome；已询问是否能看到前轮全局任务区域/按钮。

## 2026-09-30 运行版本核实与恢复验证
- 用户回复完全看不到“下载任务 / 全部页面”和操作按钮。不能据此单独认定是哪一路径：旧目录构建或无任务时旧模板隐藏区域/静默同步失败均可能。1.0.1 固定显示版本号与任务区，错误可见，提供明确加载目录。
- 源/manifest/package/lock 版本统一为 1.0.1。持久任务 storage.local，session 旧任务迁移；popup 直接读本地并监听 changes，当前候选按 canonical URL 关联旧任务。
- offscreen 下载完成发送 BUFFERED_RESULT 事件，替代依赖旧 worker 内 Promise 的完成回调；恢复时重新安装丢失的 Referer/Origin 规则；无后台暂存时保留任务并提供重新获取。
- 原工具栏测试 target 为 page 但 Playwright context.pages 不暴露；改为直接 CDP attach chrome.action.openPopup 所创建目标。headless 打开后需恢复正常窗口焦点；worker.waitForEvent(close) 未收到事件，改为 CDP workerVersion runningStatus=stopped 严格核对。

## 2026-09-30 1.0.1 遗漏路径
- popup.startDownload 对 HLS 直接 await downloadHlsStream；该函数在 popup 中执行 fetch/分片数组/Blob，且不保存 nativeDownloadTasks。
- 当前后台入口 startNativeDownload 只允许 MP4/WebM；前轮真正 popup 验收也只覆盖 MP4。因此此前验收不能证明 HLS 跨页面持续。
- 将两种下载统一为 offscreen 执行、storage.local 元数据、worker 完成事件；HLS 独立保存分片并支持暂停/继续/取消。

## 2026-09-30 1.0.2 最终证据
- 用户确认故障类型是 M3U8/HLS，与源码的 popup 独立下载路径一致。
- 新后台任务保存来源/清晰度，HLS 每个清单/分片/密钥请求附带来源，规则仅匹配扩展请求；失败/完成/取消清理。
- 暂停复用已完成分片，继续按原顺序拼接；显式 IV 改为网络字节序，36 个受控加密 TS 分片显式及隐式 IV 输出字节均一致。
- 13 组常规检查、17 项真正 popup 检查通过；HLS 独立报告 hls-lifecycle-validation.json（9 项），保存/期望各 27072 字节。
- 原站点整集与解码仍未验收。旧 1.0.1 HLS 没有任务持久记录，只能重新开始。

## 2026-09-30 扩展批量需求初查
- 用户指定 lvsc168 /movie/93518.html 与 /play/93518-0-0.html、0-1.html，要求图标正在下载数和剧集批量。
- 当前角标显示按标签页捕获媒体数，需替换为全局下载任务数。
- Windows 已有 Myui 详情解析可参考，但扩展须独立实际浏览器验证，不直接沿用旧验收。
- web 页面抓取工具对三条链接均无法访问，将切换实际浏览器取证。
- 实际浏览器详情页确认《心动APP之青梅好感爆了第二季》“高速”线路 128 集；详情使用 #playlist1，播放页使用 ul.myui-content__list.playlist。
- 首集 /play/93518-0-0.html 脚本 var now=base64decode(...) 指向 svip.ryplay16.com/share/...；嵌套播放器 DOM 有 var main 的签名 M3U8 URL。需实际打开每集页面并捕获嵌套播放器，不能把播放页地址当下载链接。
- 实现：从当前页实际链接提取相同作品/同源线路，支持 Myui 页面结构；不递增猜测剧集 URL。新增后台剧集队列，默认 2 槽，先持久化排队，再逐集解析播放器媒体。
- 角标从捕获数量改为全局 preparing/resolving/downloading 任务数；旧版本按标签覆盖会在 worker 启动时清理。
- 批量文件默认自动保存 StreamHarbor/作品/线路_集名，手动单文件仍用原保存对话框；剧集失败重试重新解析播放页。
- 增加 alarms 唤醒，worker 重启可重连持久化解析标签；已加入排队/解析状态与取消操作。

- 实际浏览器第二集确认同作品 128 集，vpart=1，播放器 share ID 与首集不同。
- 新集成测试首轮误用 worker runtime.sendMessage 向自身发消息，Chrome 不会投递给发送者；改用真实 popup/扩展页面发控制消息，重新验收。

- 强制停止 worker 的新回归发现解析标签持久化后、导航前中断，会在恢复时错误复用 about:blank。已修正为恢复空标签的导航，并持久化解析起始时间避免 worker 重启无限延长超时。
- 完整环境仍复现新建 about:blank 后再 update 的第二个后台标签停留 unloaded，网络只发出了根页请求而未加载 iframe。改为 tabs.create 直接带播放页 URL，减少空标签导航切换，继续实际验证。
- storage 返回对象键顺序不保证排队顺序；补入独立 queueOrder，保持剧集选择顺序，不依赖相同毫秒时间戳和随机任务 ID。

## 2026-09-30 剧集批量最终核心验证
- 新标签直接用播放页 URL 创建后，五组真正 popup 批量集成检查全部通过；验证两集并发、角标 2/1/空、排队取消、重复去重、暂停后 worker 重启恢复、重试、持久空标签恢复与保存字节一致。
- 最终 Chromium 扩展会话真实读取 /movie/93518.html 的 128 集“高速”线路，前两集真实批量完整落盘，非仅网页抓取或候选发现。
- 第01集 20621908 字节，FFprobe H.264 1280x720 / AAC / 119.356556 秒；第02集 14608164 字节，同编解码及分辨率 / 111.689889 秒。实际保存大小等于任务合并 receivedBytes。
- 证据：series-validation.json、series-live-validation.json、series-live-preview.png；未做全片深度解码或其余 126 集下载验收。
- 实测 screenshot 表明完成记录较多时剧集区被推到下方，已限制任务列表滚动高度，保留剧集入口易找。

- 最终角标迁移额外验证：人为设置当前标签旧值99，worker重启后恢复全局下载2，证明标签覆盖已清除。最终截图 series-preview.png 已复核深色布局与任务列表独立滚动。

## 2026-09-30 首尾播放页范围批量下载
- 用户要求将自动识别入口改为首集/末集链接输入。生成连续播放页，逐集入槽解析媒体，不递增视频签名地址。
- 同源、固定文本和其他数字一致，仅一个数字字段变化；拒绝倒序、超过2000集和媒体直链。保留编号补零、0起始与查询参数。
- [x] 首尾输入、可选名称、生成范围/逐集链接预览、多选全选、草稿恢复及后台独立验证完成，版本1.0.4。
- [x] 20项范围检查、6组真正popup批量集成、13组常规回归、17项生命周期、TypeScript/Vue检查通过。受控HLS完整合并落盘字节一致。
- [x] 真实LibVio两集分别解析v.libvio.app的Lanterns.S01E01.mp4和S01E02.mp4并进入下载，随后暂停取消；未完整下载/解码本轮真实两集。
- esbuild范围测试在沙箱访问父目录失败，经批准使用完整环境后通过；真实浏览器测试无需该升级。

## 2026-09-30 juok3 HLS 分片校验失败
- 用户询问绿色影视识别规则：core/series.ts与后台/content读取仍保留，1.0.4界面不再自动展示。
- 排查指定播放页真实清单/分片，依据实际格式修复，不直接去掉媒体完整性校验。
- [x] 真实浏览器证据、实现修复、匹配测试及构建交付（清单重放与上游404的验收边界已记录）。
- 指定站点《兰香如故》第6集：581个分片；PNG URL与代理URL样本均200/image/png，PNG IEND结束于120字节，随后188字节同步TS包。原校验首字节0x47导致拒绝。
- 修复：仅识别完整PNG签名与IHDR/IEND结构（上限1MiB），精确移除图片边界之前的字节；检验余下全部188字节TS同步字节，不扫描或忽略任意垃圾数据。
- [x] PNG结构识别与完整TS包同步校验实现，13项分片检查和20项真实popup/HLS生命周期检查通过。
- 用户追加要求：删除绿色影视专用列表识别，仅保留首尾链接通用批量；已删除Myui discoverSeries、GET_TAB_SERIES/GET_SERIES_CATALOG/ENQUEUE_EPISODES入口与后台专用路径验证，保留通用播放器媒体配置嗅探（player-media.ts）。
- 真实扩展会话新签发清单返回404；此前正常浏览器现场清单随后也404。已记录hls-upstream-validation.json，不将上游404归因于分片修复。改用现场已捕获581分片清单本地重放，所有分片仍按原URI远程获取，验收边界单独标注。
- [x] 移除绿色影视专用识别后的构建与类型检查通过，通用媒体嗅探保留。
- [x] 使用现场已抓取清单重放，581个原URI真实远程PNG分片全部下载/规范化/扩展原生落盘；625878132字节，移除69720字节封装；FFprobe H.264 1920x1080/AAC/2802.24秒。未做全片深度解码；当前上游新清单404，不能宣称重开网页的一键整集验收通过。
- 证据：hls-site-probe.json、hls-segment-probe.json、hls-upstream-validation.json、hls-png-live-validation.json；实际文件与临时profile由测试结束时清理。
- [x] 删除专用识别后6组通用批量回归通过；最终1.0.5 ZIP根manifest/四入口/权限/压缩完整性与旧入口移除核验通过。
- ZIP: 61371字节；SHA256 a910908695d2c37cb4902cc28b5187028792b6e7baa28d7e0b516b951d5234a8。

## 2026-09-30 三页面与清空操作 1.0.6
- 当前捕获/剧集批量/下载任务三页，默认捕获；沿用现有深色系统字体和绿色状态导航，固定头部与标签、独立滚动内容。
- 批量输入一键清空并保存空草稿；完成任务在后台串行单次持久清理，保留文件/未完成/失败/取消记录；去掉本页列表清理UI与消息入口。
- [x] 类型/构建、实际popup页面切换/清空、队列回归、ZIP核验。
- 用户追加：两清空按钮严格限定在对应页面；所有单文件下载改saveAs:false，使用Chrome默认下载目录，批量保持默认目录下StreamHarbor分组。
- 三页面/清空/队列9组真正工具栏回归通过；接下来验证原生默认目录与禁用保存对话框，不使用测试强行改写saveAs。
- 用户追加：角标改本标签页捕获数（替代全局下载数），刷新/导航时重置，后台重启按session恢复；任务顺序运行→排队/暂停→失败/取消→完成，排队按queueOrder。
- 原生默认目录验收已通过（21项popup生命周期）；Chrome全局prompt_for_download=true时仍弹窗/无头中取消，false时无需CDP强制下载路径即可落盘。扩展saveAs:false不能覆盖浏览器该开关，记录边界，未改用户Chrome全局设置。
- 捕获角标回归发现启动时persist先于session恢复，可能覆盖捕获列表；已等待恢复后再持久化，并标记导航/关闭标签跳过旧数据。最终11组真正popup/角标/排序/清空/队列检查通过。
- 最终13组常规下载回归通过；1.0.6 ZIP根manifest、四入口、权限、压缩完整性及旧入口移除核验通过。62481字节，SHA256 f15eee3d4290181840f442f923c99ff84ada3e731f4f485109feef1fd56a512f。临时Chrome运行时已清理。

## 2026-09-30 Chrome 扩展平台核查
- 当前平台调度仅 Bilibili；Instagram / Facebook 无专用解析器。通用捕获仅 HTTP MP4/WebM/M3U8，blob/DASH 不能直接下载。
- Chrome 扩展 1.0.6 有现成下载完整性、来源请求头、后台任务及测试脚本；新增支持复用该路径。
- 当前 yt-dlp 官方提取器确认 Instagram video_versions/video_url，Facebook videoDeliveryLegacyFields 与新 progressive_urls/hls_playlist_urls；优先读取页面已有数据，不硬编码私有 GraphQL doc_id 或提交账户请求。
- web 工具访问公开样本失败，转隔离 Chromium 真实页面检查；代码支持与真实站点验收分别记录。
- Meta浏览器11组检查通过：IG轮播/1080p、document_start fetch、Facebook XHR新版HD字段、完整MP4落盘、短链重定向、页面复用、伪造URL拒绝、DASH提示、SPA清理、受限页保留。两站受控下载各262144字节一致。
- 第一轮匿名真实页面：Instagram可见帖文与登录提示但未捕获直链；旧Facebook样本显示视频无法再观看。正在进一步核查实际字段与可访问公开视频。
- 最终公共Facebook页面已捕获SD/HD并通过扩展真实完整落盘1419576字节，源响应声明长度与落盘一致。旧样本不可观看，使用该页实际视频推荐链接取证。Instagram仍有提取遗漏，正在独立字段诊断；暂不宣称其真实下载通过。
- 常规13组、popup21项（含HLS/PNG/AES/自动保存）、批量11组全部通过。
- 实际事件序列证明Instagram候选曾发送，但其后子iframe的loading/complete误清理主页面。仅靠tabs.status不足以区分页面导航；已改主框架webNavigation事件，并保留SPA history变更清理。
- 真实最终IG Reel：918120字节，H.264 480x854/4.966667秒；源数据has_audio:false，FFprobe无音轨一致。真实Facebook视频：11647988字节，H.264 720x1280/AAC/61.374708秒；响应声明/收到/落盘字节一致。未做全片深度解码。证据meta-live-validation.json。
- 当前明确的专用解析器：Bilibili、Instagram、Facebook；其他主流平台无专用适配，MP4/WebM/HLS格式通用嗅探不能替代逐站支持声明。
- 已将过时角标与裸BV/AV/短链支持说明修正；历史版本记录保留。

## 2026-10-08 蜘蛛网图标
- 扩展版本 1.0.7，Manifest V3。manifest 的 icons 与 action.default_icon 均需要替换。
- Vite 构建会复制 src/icons 至 dist/icons；新增 32 像素图标供工具栏使用。
- 生成原图为 1254×1254，Format32bppArgb，角像素 alpha=0，确有透明边缘。
- 概念/原始提示：青色简洁蜘蛛网包围白色播放三角，深蓝圆角背景、外围透明、无文字，适合小尺寸识别；通过内置 image_gen 生成，本轮沿用用户确认的图像。

- 新图标四种尺寸的 RGBA PNG、源码/构建一致性、六入口与 ZIP CRC/逐文件读取核验通过；128 像素成品已视觉检查。

## 2026-10-08 绿色影视搜索
- sites.ts 的 searchForm 仅接受 form 内 input[name=wd/searchword]；绿色影视和嘀嗒影视共用 myui。待核对当前 DOM。
# 2026-10-08 Windows Meta 支持调查

- windows/src/main/resolver.ts 仅 Twitter 与国内平台专用分支；Meta 只有通用网页 / 网络捕获。
- extension/src/core/meta-media.ts 识别平台、目标帖子、已知 progressive 字段、JSON 字符串嵌套与 OG 标签，并保留 CDN 签名、移除 bytestart / byteend。
- 原始 MP4 网络请求可能是分离轨道；桌面 Meta 路径应只接收已知 progressive 字段，不降级到任意 CDN 嗅探。
- 现有下载引擎支持完整 MP4 与 HLS；本次沿用 MP4 能力，DASH-only 应显示具体限制。
- 现场 Instagram 目标可解析和完整下载；Facebook 两个样本导航无法打开。本轮功能与受控集成已验证，不能宣称 Facebook 现场完整下载通过。
- 共享解析器引入同级源码依赖，export-source.py 必须保留 windows/ 与 extension/src/ 层级；最终运行包由 esbuild 嵌入解析器。


- 原生 Electron：800ms 为 Cloudflare 安全验证页（无 form）；继续等待 8s 后主页出现原 searchword GET /search.php 表单。嘀嗒仍用 wd。根因为读取过早与误分类，采用同窗口最多追加 10s 等待，未完成转 ACCESS。


- 最终真实搜索：绿色影视 1 条结果，2 线路各 8 集；嘀嗒 1 条结果、8 线路。证据 myui-search-live-20261008.json。本轮仅验收搜索与详情，不计整集下载。
- 独立正确性审查：Cloudflare 正常 JSD 脚本路径也含 challenge-platform；已收窄到 orchestrate/chl_page，增加 JSD 不误判回归。官方 https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/ 。

## 2026-10-08 双客户端图标
- Windows 现有 win.signAndEditExecutable=false 禁用 EXE 图标编辑；当前 electron-builder 26.15.3 支持 signExecutable=false，仅关闭签名而保留图标/元数据写入。
- iOS App 下尚无 Assets.xcassets。project.yml 包含 App 资源，需要显式 ASSETCATALOG_COMPILER_APPICON_NAME=AppIcon。
- iOS 图标使用 RGB 不透明背景，保留蜘蛛网/播放标识；Windows 保留透明 PNG/ICO。桌面和手机页面的箭头品牌标识同步替换。
- 权威参考：https://www.electron.build/v26/docs/api/app-builder-lib.interface.windowsconfiguration/ 及 https://developer.apple.com/documentation/xcode/configuring-your-app-icon 。
- GitHub main 基线 7d82c404 与本地 iOS 非图标源码相同，采用最小18文件提交 5d9c0376。云构建 run 37761235493 使用该提交。iOS前端与HLS核心检查通过。

- IPA实际布局只有独立AppIcon60x60@2x.png，其余图标由Assets.car承载；本地错误的多PNG假设已修正。CgBI PNG解码后的120×120 RGB像素与源图一致，前端PNG、版本11、ZIPCRC和云端SHA256全部通过。

## 2026-10-09 三端说明核对
- 根 README 仍称两端，遗漏 extension，iOS 仍指向构建号 10 的旧运行。
- extension README 将多个历史版本的角标、自动剧集识别、页面布局与安装步骤混作当前指南；当前版本为 1.0.7。
- Windows README 的使用步骤仍指向旧 release 根目录，最新图标包在 spiderweb-20261008。
- iOS 验证说明包含过时的 DISCONTINUITY 拒绝及待 Mac 测试状态，需要逐条对照源码和保存的构建证据。

- 已直接读取 Windows 三个发布目录的 app.asar；spiderweb 版主进程与当前 windows/dist/main/main.cjs 逐字节相同，包含 Meta/国内平台/X 解析与 Cloudflare 等待修复。
- iOS 当前 UI 已删除样本按钮，支持完成/取消任务逐条删除记录；原 README 的样本按钮和完全不支持记录清理说明过时。
- iOS HLS.swift 已支持 DISCONTINUITY，DownloadSchedulingTests 已在保存的构建号11日志中随22项核心回归通过。
- extension 无独立音轨合并或直播轮询；HLS为内存TS拼接，不能写成磁盘流式下载或MP4转封装。
- 报告位于 extension 根目录（不是extension/artifacts）；图标ZIP105076字节。Windows图标包主进程与当前dist一致；iOS IPA8524659字节。

- 当前说明已统一到扩展1.0.7、Windows1.0.0蜘蛛网包、iOS1.0.0(11)。扩展历史段落移入新VALIDATION.md，最新iOS发布侧说明已同步。
- 最终复核原生测试：16项实际覆盖包括记录删除的持久化回滚与保留输出；旧文案计划中的迁移/改变格式回滚不能当作已执行测试，已纠正当前覆盖说明。
- 静态核对通过：9份文档、68个本地链接、30处命令入口；4个交付文件大小与SHA-256匹配，扩展ZIP/IPA CRC与内部版本通过。客户端源码/二进制和既有机器验收报告未改动。

## 2026-10-11 Windows 修复范围
审查确认：会话媒体串线、重新下载取消竞态、HLS重定向基准、YouTube分辨率降级、Bilibili分P/多段、抖音HTML兜底、搜索范围与分页。已有49测试在审查中通过但未覆盖这些路径；本次补失败回归。

修复结果：媒体捕获按窗口过滤，同Session排队；手动/自动重新解析共用取消控制并检查任务身份；HLS使用最终URL；YouTube精确高度；Bilibili按p选cid/多段拒绝；抖音延后关闭HTML；搜索清理失效scope并绑定提交关键词。独立复核未发现新阻断项。

Windows当前本地交付更新为release/1.0.1（setup与portable）；SHA256SUMS和package-validation记录哈希。旧Windows发布产物已按授权清理。安装/卸载与portable自解压启动未执行，打包应用及内嵌负载已验证。

## 2026-10-27 GitHub 同步核查
本地无 .git；README 指向 gaopan513/videoDownload，三端版本为扩展1.0.7、Windows1.0.1、iOS1.0.0(11)。本轮新增核查记录不作为原有未上传改动的判断依据。

远端 main 为194d5247（2026-10-08）；GitHub Releases 为空。扩展主体与Windows搜索/Meta/YouTube/1.0.1修复未上传；iOS原生源码仅有换行差异。111项待同步文件（含本轮忽略规则及临时测试证书生成修正），无远端独有文件。探针报告/预览和测试私钥保留本地。yt-dlp是随包官方工具，按既有THIRD_PARTY的SHA256核验后随源码上传。
