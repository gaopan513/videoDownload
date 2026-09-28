# Findings

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
