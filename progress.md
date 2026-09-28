# Progress

## 2026-09-28：仓库更名与目录拆分
- 已确认目标结构为仓库根目录下 `ios/` 与 `windows/`。本地已移动两端源码、脚本与桌面依赖缓存；根目录保留共享文件、历史产物和计划记录。远端尚未修改。
- 已更新 iOS Actions 工作目录、媒体/XcodeGen 缓存路径、打包路径与原生库搜索路径；Windows 构建入口保持子目录相对路径。Windows 30 项、iOS 解析 10 项测试及两端类型/前端构建通过；Windows 主进程构建、iOS Swift 语法/夹具哈希与两端源码包验证通过。
- 112 个源码/文档文件写入私有仓库，提交 `0a3494a17fb579ae39c08c0fe1f21506600bb3e1`；仓库从 `ios-videoDownload` 更名为 `videoDownload`，同一仓库 ID、`main`、私有属性均保留。云构建 run 36446663138 已启动并完成初段检查，后续待结果。
- run 36446663138 成功，iOS 原生测试和 IPA 归档通过；IPA artifact 10981395126 已生成。未下载/真机安装本次 IPA，目标站整片下载尚无新证据。


## 0.2.2 (9) 已上传并云构建成功（2026-09-11）
- 提交链：24f9d20a（8+9 两轮 6 文件）→ 7c39e5c7（static 裸调用修复）→ 1901a807（expandDetected→expand）→ c2328549（MainActor 状态先拷贝再进 nonisolated 闭包）。main 最终 c2328549，全部 blob 与本地核验一致（60/60，根 README 仍保留远端 iOS 版）。
- 三次构建失败均为本地检查器盲区（tree-sitter 不查语义）：①实例方法内裸调用同类 static 成员；②引用了不存在的 expandDetected；③捕获列表捕获 @MainActor 属性引用后在 nonisolated 闭包中读取。已全部修复，并新增本地脚本化成员引用审计。
- run 34581622219 success：核心 22 + 原生 16 测试 0 失败，TEST/ARCHIVE SUCCEEDED。
- IPA：release/ios/0.2.2-9/StreamHarbor-iOS-unsigned.ipa，7,360,757 字节，SHA256 ed683699...72beb8e9（与清单一致），arm64、0.2.2(9)、iOS 17.0、bundle 检查通过；报告 release/ios/0.2.2-9/verification-0.2.2.json。
- 待真机：解析等待时间、候选垃圾过滤效果（含误杀反馈）、下载速度 A/B。

## 0.2.2 (9) 候选垃圾资源过滤（2026-09-11，本地完成，未上传）
- 问题：解析时同页发现多个媒体地址，其中多为广告片段/统计接口/同一文件的签名变体，用户需要手动分辨。
- 捕获端过滤（注入脚本）：跳过统计/广告主机（clarity、google-analytics、doubleclick、cnzz、umeng 等）与广告路径关键词（/ads、banner、promo、logo、intro、outro、watermark 等）；真实正片路径不受影响。
- 证据分级：来源标记 origin——video 元素（最强）> 程序化请求 fetch/XHR（次）> 资源时间线扫描（最弱，混入广告预载）；同一 URL 重复出现时只升不降。
- 展开排序与去重：展开前按 origin 优先级排序（播放器驱动来源先探测），同一路径（去掉签名 token 后）只保留一个探测，不再为同一文件重复发起请求。
- 本地通过：14 Swift 语法、10 项 JS（新增 3 项过滤回归：遥测域名、广告路径、origin 分级）、15 项核心、Vue 类型/构建、分段算术。版本 0.2.2(9)，源码包重导出（62 项一致，SHA256 cf3c7bcd...09b2be）。
- 未执行：Xcode 类型检查、XCTest、新 IPA、真机复测。过滤为通用启发式，不针对具体站点；若真机出现误杀（正片路径含 intro 等词），需按报告反馈调整。

## 0.2.2 (8) 解析/下载性能优化（2026-09-11，本地完成，未上传）
- 解析并行化：Resolver 中发现的媒体地址（最多 12 个）由逐个串行展开改为 4 路并发任务组，结果与失败信息按发现顺序合并；一个慢主机不再拖慢其余候选。expand/candidates 改为 nonisolated static（纯网络函数，不触碰实例状态）。
- 解析读取提速：HTTP.read 在服务器声明 Content-Length 且不超过上限时改用一次性缓冲读取；此前逐字节异步迭代（45 KiB 列表 = 45,000 次挂起）。无声明长度时仍走流式路径，4 MiB 上限与校验全部保留。
- 死主机快速失败：探测请求超时 45s→20s，解析会话空闲超时 30s→15s、资源总超时 60s→90s（允许慢但仍在流的响应完成）。并行展开下最坏等待从 12×45s 降为约 3×20s。
- MP4 分段进度显示：分段下载时与 HLS 一致显示「已完成 x / y 段」；整文件 MP4 仍只报字节（无天然分段数）。
- 本地通过：14 Swift 文件语法树、7 项 JS、15 项 Windows 核心测试、Vue 类型检查/生产构建、分段算术复算。版本标记 0.2.2(8)，源码包重导出（62 项一致，SHA256 23f3170d...769b05a）。
- 未执行：Xcode 类型检查、Swift 核心/原生 XCTest、新 IPA、真机复测。并行展开的 tokenizer 兼容性：withTaskGroup 载荷使用具名 struct（本地 tree-sitter-swift 0.7.3 不解析 Result 元组泛型，Swift 编译器无此限制）。

## 0.2.2 (7) 已上传并云构建成功（2026-09-11）
- 17 个文件上传私有仓库 gaopan513/ios-videoDownload 的 main，提交 dcad236e8ddd0b4c4b27236e19d1d4debef49516；远端 blob 与本地逐文件核验一致（60/60，根 README.md 按用户决定保留远端 iOS 专用说明，未覆盖）。sh/py/mjs 文本按 .gitattributes 规范为 LF 后上传（构建脚本含 CR 曾致失败）。
- run 34556255163（workflow_dispatch）首次在 Build pinned XcodeGen 步骤因 runner DNS（Could not resolve host: github.com）失败，与源码无关；rerun --failed 后整体 success，用时 21 分 21 秒。
- 云端测试：核心 22 项（含本轮新增 3 项 MP4 分段边界/覆盖/上限回归）与原生 16 项全部 0 失败；TEST SUCCEEDED、ARCHIVE SUCCEEDED。
- IPA 已下载到 release/ios/0.2.2/StreamHarbor-iOS-unsigned.ipa（7,345,997 字节，SHA256 d3eda0c54982425375e2b1987a6e7666ef500c2ea4257da8098e6294618c1731，与构建内 SHA256SUMS 一致）；arm64、0.2.2(7)、iOS 17.0、Web 资源与 bundle 布局检查通过，核验报告 release/ios/0.2.2/verification-0.2.2.json。
- 待 iPhone 验收：MP4 分段与整文件 A/B 提速、HLS 前后台切换与暂停/取消/恢复、三站整片下载与导出。

## 0.2.2 (7) 下载提速与 gaze 结案（2026-09-11）
- 复核 0.2.2(6)：juok 零时长修复（`Core/HLS.swift` 接受 `value >= 0`）与 kanju HLS 前后台会话交接（`Native/DownloadEngine.swift` 的 `setForeground`/会话选择）均在当前源码中，未回退。
- gaze 结案（用户决定不再投入）：真实 Chrome（CDP，移动 UA）实况取证显示，站点验证可自动通过，播放器用 `data:application/vnd.apple.mpegurl;base64,...` 播放 `blob:` MSE，页面 65 个请求中 0 个可直接下载的媒体地址；分片名被站点自定义编码，且需要站点内 `DimGive`/凭据现场解密。属单站定制适配，按用户指示暂缓，不计入本轮验收。
- 提速改动（按真机可验证的瓶颈排序，全部带本地回归）：
  - MP4 由单连接整文件改为**按字节范围并行分段**（`DownloadScheduling.mp4Chunks` + `HTTP.mp4Ranges`）：仅当 1 字节探测返回 206 且带 `Content-Range` 总长度、文件 ≥16 MiB 时启用，8 MiB/段、最多 4096 段；服务器不按范围返回时自动回退为整文件下载（`degradeMP4`），并清理旧分片。
  - 分片完成后的**加密任务索引写入移出主线程并合并**（`persistSoon`/`drainSaves`，串行 `saveQueue`）；进入后台、释放系统后台完成回调前同步 `flushSaves`，保证挂起前落盘。
  - 启动恢复不再在主线程顺序重算全部分片哈希，改为后台串行校验（`verifyQueue`），校验失败仍将该任务置为失败。
  - MP4 分段合并改为**边读边算哈希边写**（单次读），并校验各段 `ETag/Last-Modified` 一致、长度一致，避免把不同版本的字节拼成一个文件。
  - 新增 `planGeneration`：分段方案被替换后，旧分片的迟到哈希回调会被丢弃，不会写入新方案（`Models.swift`）。
- 本地证据：14 个 Swift 文件语法树通过（同时修复 `scripts/check-ios-source.py`：改迭代遍历、缺依赖明确退出 2，不再依赖空占位目录）；7 项 JS、15 项 Windows 核心测试通过；Vue 类型检查/生产构建通过；分段切分算术用 Node 复算（`CHUNK LOGIC: OK`，104869945 字节 → 13 段、连续且精确覆盖）。新增 3 项 Swift 核心回归（分段边界/覆盖/上限）。
- 源码包已按最终代码重导出：`release/ios-source/StreamHarbor-iOS-prototype-source.zip`，62 项逐文件一致、ZIP 完整，SHA256 `7ba4dafc3d6549758d57b33a66cb6eafbfb0861ded1ab5de197e3757de9dc9e5`；版本标记 0.2.2(7)，报告 `release/ios-source/verification-0.2.2.json`。脱敏证据：`artifacts/gaze-verification-findings.json`、`artifacts/ios-throughput-ordering.json`。
- 未执行（Windows 无 Xcode）：Xcode 类型检查、Swift 核心 22 项与原生 16 项 XCTest、新 IPA、iPhone 实测提速对比。分段方案是否优于单连接取决于运营商/CDN 对单连接限速程度，需真机 A/B 验证，不预称提速倍数。

## 0.2.2 (6) 本地修复候选（2026-09-11）
- 源码包 `release/ios-source/StreamHarbor-iOS-prototype-source.zip` 已导出，61 项与本地逐文件一致、ZIP/版本/哈希检查通过，报告 `release/ios-source/verification-0.2.2.json`。已停止本轮 12 个诊断进程，清理临时脚本、签名链接、样本和浏览器配置；保留三份脱敏 JSON 证据。gaze 验证页保留用于后续获准操作。
- 已读取三个文档，当前需求按用户本轮报告处理，文档历史上传授权未作为本轮发布授权。
- 完成 juok 现场零时长定位、kanju 列表及前三片 Range 响应验证、gaze 验证页检查。只保留脱敏证据，临时签名链接/下载片段在收尾清理。
- 修改 Resolver、HLS、DownloadEngine/DownloadScheduling：零捕获保留页面和临时验证会话、零时长不丢片、HLS 前后台会话交接、进度与等待诊断。版本准备为 0.2.2(6)。
- 新增 1 项 JS、2 项核心、3 项原生回归；原生覆盖 Range 交接、旧回调、暂停/取消、持久化、整文件 MP4 不重启及零时长封装。提供隔离测试存储，不触碰生产 Keychain。
- 已通过：7 JS、14 Swift 文件语法/资源哈希、Vue 类型检查/生产构建，Windows 合成零时长视频 24 包保留、2 秒和完整解码。
- 未执行：Xcode 类型检查、19 项核心/16 项原生测试、新版 IPA、iPhone 三站整片与前后台测速。gaze 人机验证操作已请求确认，未获得答复前不点击。
- 工具记录：Electron 沙箱 GPU 崩溃，正常权限启动后 debugger 初始化仍无结果，改用内置浏览器；误查 Native/HarborPlugin.swift（实际在 App）；一次补丁重复文件操作被拒绝后合并重做，未造成半修改；web 无法读取 Apple Markdown 时改普通 HTTPS 读取官方文档。

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

## iOS 分片下载性能优化（2026-09-10，本轮）
- 用户确认慢在“下载分片时进度增长慢”；按要求暂停上传与云构建，当前没有远程提交。版本已准备为 0.2.1 (5)。
- 后台会话改为每任务最多预提交24个分片，低于8个补齐；每主机连接上限4改6，仍最多2个活动任务。预提交队列与实际连接数分开限制。
- 删除每次启动分片/成功网络回调的重复整表持久化；完整任务计划在新增/继续时先保存，调度状态变化每批保存一次，分片哈希完成后仍立即加密持久化。
- 文件哈希移到单独串行utility队列；正在校验的分片占用队列名额、防止重复下载。取消/删除后按任务ID重新查找，忽略过期网络回调；后台完成回调等待网络事件及哈希完成。
- 高频进度回调限为每250ms发布一次（关键状态仍即时发布），进度包含正在接收的分片，显示累计MiB。
- 新增5项核心回归：批次补充与失败重试去重、恢复与尾部排空、3000片完整调度、进度限频/部分字节、后台完成回调两种顺序与晚到handler。
- 本地14 Swift文件语法树、plist/夹具哈希、移动端Vue类型检查通过。Swift核心/原生回归尚未运行，需Mac/Xcode；未测速，不宣称具体加速倍数。
- 操作记录：仓库目录没有.git，远程main只读核查为ae2dc7e；Info.plist初次读取受Windows默认GBK影响，已明确UTF-8完成。没有上传代码或触发构建。

## IPA 界面清理（2026-09-10）
- 已移除首页“验收样本”及三个站点快捷按钮、“iPhone 原型”徽标和“三站真机验收中”提示，清理对应数据和样式，调整输入框下方间距。
- Vue 类型检查和移动端生产构建通过；源码和 dist 中已无上述文案及样本地址。首次构建命令目录错误，切换 mobile 后通过。
- 尚未重新打包 IPA，此修改随下一次 iOS 构建生效。

## 本轮修复候选：HLS 本地 .plain 后缀（2026-09-10）
- 已读取三份文档；将文档中的历史指令、授权和状态作为背景，本轮按用户报告检查 iOS 故障。
- 修改 MediaBridge.c、Transcode.c 和 HLS.localConcat 的本地读取选项，修复 FFmpeg 7.1.1 格式/后缀检查拒绝 `.plain` 的缺陷；新增 fMP4 三模式原生测试与夹具，调整不连续 TS 回归使用真实本地命名。
- 已通过：固定 FFmpeg 源码 SHA256 与检查逻辑核验、12 Swift 文件语法树、plist/全部夹具哈希、夹具脚本 Node 语法检查。未运行 Xcode 编译/原生回归（Windows 无 Xcode）。
- 新版源码仅在本地，尚未上传、未生成新版 IPA；不能拿原有 0.2.0(4) 验证本轮改动。下一步为 macOS 原生回归和 IPA 构建，再由 iPhone 复测该页三种输出。
- 路径探索曾误查不存在的 mobile/scripts，已改用项目根 scripts；未遗留临时诊断下载文件。

## mrds66 媒体处理失败排查（2026-09-10，进行中）
- 用户澄清：故障发生在移动端 iOS 0.2.0，而不是 Windows；当前错误对应原生 `Media.swift` 的通用媒体处理分支。
- 先前桌面端实测不适用，已终止该方向；未修改产品下载或处理逻辑。待取得此页 iOS 链路的 HLS 分片与原生处理阶段证据后再判断能否修复。
- 会话 Cookie 转发到媒体主机的诊断尝试被安全策略拒绝，未执行；后续只做无 Cookie 的公开媒体响应验证。
- 无 Cookie 现场检查完成：两路 fMP4 VOD 列表、初始化片标记和各前三个媒体分片均正常；未修改产品源码。临时 Electron 诊断入口及下载目录已删除，仅保留脱敏 JSON 证据。
- 结论：不能把该失败归因于分片缺失。已缩小到 iOS 本地 fMP4 `EXT-X-MAP` 重建/`harbor_convert` 的共同路径；尚缺 Mac/iPhone 原生执行或新增诊断分类来识别具体 libav 错误。

## 0.2.0 编码对齐（2026-09-10，本轮）
- 已接入桌面 MP4 编码集合、MKV 无损保存、VideoToolbox H.264 / FFmpeg AAC 转码；贯通 UI、Bridge、加密任务状态、失败重试和导出。
- 旧记录按 MP4 恢复，重试更改输出格式先持久化再更新内存；已完成分片保留。新增时长检查，深度解码可选。
- FFmpeg 7.1.1 增补解码/封装/滤镜，dav1d 1.5.1 来源和 SHA 固定；重链接材料包含新依赖。
- 本地前端类型/生产构建、6 项 JS 回归、12 Swift 文件语法与夹具哈希检查通过。新增原生编码矩阵/转码、核心迁移/回滚测试待 Xcode，不记为已通过。
- run 34442498057 在媒体库构建阶段因 `set -u` 展开空 `MESON_SETUP` 数组失败；修复提交 ae2dc7e 改为首次构建与缓存重配置两条显式 Meson 调用。
- run 34443702921 成功：媒体库、XcodeGen、12 项核心和 12 项模拟器原生测试、iPhone arm64 归档及 IPA 上传均通过。artifact 与 IPA SHA-256、版本 0.2.0(4)、Payload/Web 资源和 arm64 Mach-O 已在本地复核。

## 0.1.2 修复候选（2026-09-10 最新）
- 毒舌已实时定位为 DISCONTINUITY 被主动拒绝。实现标记持久化、旧任务兼容、MAP 重发、分组 HLS + ffconcat 重建连续时间戳，启用固定 FFmpeg 的 concat demuxer。
- 拾光：同一新网页会话内列表 HTTP200，但 static.yximgs.com 前两个分片均404；不宣称客户端可恢复缺失资源。修复预检吞404并允许入队的问题，失败细分到列表/密钥/分片及主机。
- Swift 12 文件语法通过；Windows 合成时间戳重置样本48包单调、完整解码通过；毒舌真实切换点前后两片约6.018秒 H.264/AAC 封装完整解码通过。均不代替整片/iPhone验收。
- 新增4核心+2原生回归，待云构建。版本0.1.2(3)，已上传 main a620cdc6c39e4c3ddd03a6a7b72dc1ae68f24ce5；11 文件远程 blob 与本地核验一致。
- 需在 main 新建 Run workflow，不能重跑0.1.1旧提交。本轮启用 concat demuxer，媒体库缓存键随构建脚本变化，云端将重建固定版本 FFmpeg。

## 0.1.1 云构建验证（2026-09-09 最新）
- run 34354965766 / job 102477192710 已核实 success，对应修复提交 d1755b0e4c7276ff5820896f28d6ed1515e7f1bb。
- 6 项 JS、7 项核心、6 项原生测试全部通过；新增 WebKit srcdoc/无后缀捕获以及记录删除持久化/文件保留测试通过。iPhone Release 归档成功。
- 新版 IPA 已下载到 release/ios/0.1.1/StreamHarbor-iOS-unsigned.ipa；PowerShell TLS 错误后改用 Python 标准 HTTPS 下载成功。
- 版本 0.1.1 (2)，arm64，最低 iOS 17.0；ZIP/双层哈希/Web 删除接口核验通过。IPA 2048721 字节，SHA256 ea7e5913a886943fc6211e98ac8b95665a74066f19d5000298a8a944e9a92805。旧包保留，需使用 0.1.1 子目录内新版。
- 三站真机复测仍未完成；不将模拟器测试视为目标站支持证明。

## 修复源码已授权上传（2026-09-09）
- 用户明确授权上传 gaopan513/ios-videoDownload 并继续云构建验证，先前上传审批阻塞解除。
- 12 个源码/测试/构建文件已提交 main：d1755b0e4c7276ff5820896f28d6ed1515e7f1bb；远程 Git blob SHA 与本地 LF 规范化内容全部一致。
- Chrome Actions 控制再次超时；连接器未提供 workflow_dispatch。新提交尚无 Actions 运行，需用户选择 main 点击 Run workflow；不能 Re-run 旧提交。
- 新版原生测试和 IPA 尚未完成，三站真机结果仍待复测。

## 本轮修复进展（2026-09-09，最新）
- 已实际修改 iOS 解析和删除功能代码；旧记录“仅更新文档”指此前一轮。
- 解析：放行空白子帧、捕获未完成媒体请求及无后缀 video 地址，保留可诊断失败信息。
- 记录：完成/取消记录可删除，成品保留；写入失败不更新内存；异步恢复按任务 ID 重找索引。
- 6 项 JS 回归、移动端类型检查/生产构建、Swift 语法/资源检查通过。新增两项原生测试待云端执行，不记为通过。
- iOS 版本标记 0.1.1 (2)，旧 IPA 仍为 0.1.0，不应拿旧包验证本次修复。
- 新版源码同步 main 被自动审批拒绝：本轮未明确授权向该仓库上传源码。未创建远程 tree/commit，待用户明确授权；Actions 浏览器控制超时，尚未触发新版构建。

## 最新状态（2026-09-09，覆盖下方历史待办状态）
- 云构建和 IPA 核验成功；用户已安装并测试。
- 用户报告毒舌、剧踪、拾光均不能解析，下载记录没有删除功能；第一阶段验收未通过。
- 本次按用户要求仅更新三份计划文档，未修改功能代码、未宣称缺陷已修复。
- 下一步：优先取得三站解析失败证据并修复，同时补齐记录删除的界面/原生持久化；完成后重新构建并真机复测。
- 下方“未构建/未安装/未授权”均为此前过程记录，不能作为当前状态。

## iOS 第一阶段（2026-09-09）
- GitHub 连接已恢复，确认 gaopan513/ios-videoDownload 为私有空仓库且当前连接可写；开始上传和云构建。
- 用户指定 gaopan513/ios-videoDownload。连接账号 gaopan512-ai 访问该仓库返回 404；本机 Git 经非交互检查也无可用凭据。仓库未修改，云构建未触发，等待连接授权。
- 添加 mobile 独立 Vue 原型、Swift 模型/HLS/隔离网页识别/后台下载/加密状态/媒体封装/导出源码。
- 添加 XcodeGen 工程描述、固定 FFmpeg 源码构建、GitHub 手动云构建与待签名 IPA 打包脚本。
- 添加 Swift 核心和原生媒体测试及合成夹具；原生测试尚未执行。
- 两端类型检查、Vue 生产构建、Windows 主进程构建和 15 项核心测试通过。
- 还未生成 IPA，也未进行三站真机验证；阶段二未开始。
- 12 个 Swift 文件通过语法树检查，plist、YAML、shell 语法及合成夹具 SHA256 校验通过；不能替代 Xcode 类型检查。
- 普通 HTTP 检查发现剧踪第二条不同影片样本 60569；毒舌仍返回 HTTP 错误，拾光页面未发现其他播放链接。浏览器工具当前无可用浏览器，未完成手机宽度下的视觉验证。

## 2026-09-08
- 用户确认 grilling 决策并授权实施；读取 planning-with-files 与 frontend-design 技能。
- 创建计划、发现、开发记录。尚未声称任何真实网站支持。
- HTTP 样本检查：dushe3 返回 850；juzong01/time1080 返回 200，包含 iframe，无直接 m3u8 字面量；证据见 artifacts/site-probes.json。
- 已实现核心模块、隔离下载进程、后台 Chromium 解析和中文界面；等待安装依赖后的运行验证。
- 工具链问题：registry 最新 TypeScript 7 与 vue-tsc 不兼容（ERR_PACKAGE_PATH_NOT_EXPORTED），锁定 TypeScript 5.9.3，随后重跑检查。
- npm 首次安装无进展，中断后使用 ignore-scripts 完成；Electron 缓存改为项目 .tools；媒体安装缓存写入受限不影响已下载二进制。
- 沙箱禁止构建器父目录枚举、tsx userInfo 失败；改用 esbuild + Node test，并通过工具批准权限执行构建/验收。
- 修复 Windows HLS 相对路径解析、fMP4 测试初始化片段输出路径、Electron fetch 缺失 Response.url 导致下载失败。
- 核心 8 组测试通过，桌面 9 项验收通过；截图 artifacts/desktop.png 已目视检查。
- FFprobe 升级到与 FFmpeg 相同的 6.1.1，二进制哈希记录 media-lock.json；增加 prepare-media.mjs 保证重建一致。
- 核心扩展至 14 组测试全部通过，包含 HTTP 代理、音画起始差、HLS 恢复及无覆盖输出。
- Windows 安装包与 portable 构建成功；初次打包联网下载 Electron 超时，改用本地 electronDist；当前进行打包可执行程序验收。
- 浏览器真实样本验证达到外部时限，未确认可下载。增加解析边界 abortable、响应取消不阻塞逻辑；不将超时推断为站点不支持。
- Windows x64 安装包与便携版约 159 MB，最终哈希见 release/SHA256SUMS.txt。打包后 app.asar 内执行下载进程、随包媒体处理及任务恢复共 9 项检查通过。类型检查通过。
- 后台网页禁用 JavaScript 对话框，未配置认证时主动取消 HTTP 认证；避免隐藏窗口等待用户操作。
- 交付说明 README.md、验证报告 VALIDATION.md、许可证与二进制哈希已建立；已知未验证场景逐项列出。
- 最后代码核对修复未加密初始化片段被后续分片密钥误解密的问题；增加测试后总计 15 组全部通过。源码归档脚本会导出可重建源码并生成交付 SHA-256。

## 0.1.1 解析修复
- 已修复跨站 Referer、页面预检等待、frame 检查阻塞和 query 后缀误判。三站真实解析均成功；没有整片下载结论。
- 初次新增跨站回归遇到 localhost/IPv4 fixture 连接问题，调整为两个 IPv4 端口。构建与 Electron 诊断需沙箱批准权限；PowerShell 内嵌 Python 转义失败后改用脚本文件，Python 默认 GBK 改显式 UTF-8。
- 新增回归失败最终定位为 Referer 实际缺失（此前 localhost 假设不成立）；保留头并设策略后全部 10 项桌面检查通过，包含无后缀媒体和统计接口排除。
- 最终三站复测：毒舌 8.115 秒 HLS、剧踪 6.622 秒 MP4、拾光 8.627 秒 HLS，证据 artifacts/browser-site-probes.json。
- 0.1.1 安装包/便携版构建完成；打包 app.asar 程序全部 10 项桌面验收通过。类型检查通过；本次未改下载核心，沿用既有 15 组核心测试结果。
- 真实样本仅解析/媒体响应验证，未执行整片下载。

## 0.1.2 完成记录清除
- 下载工作台/已完成列表增加清除完成记录按钮；后端只清除 complete 记录，保存失败恢复记录，本地文件保留。
- 类型检查通过，12 项桌面回归通过，覆盖清除后文件内容不变、未完成任务保留、空列表重复清除和重启持久化。
- 初次测试错误地将成品与源视频逐字节比较（下载流程会重新封装）；修正为清除前后同一成品比较后通过。
- 0.1.2 打包程序同样通过全部 12 项验收；新增按钮布局已目视检查。

## iOS 云构建推进（2026-09-09）
- 私有仓库 gaopan513/ios-videoDownload 的 main 已上传原型源码，提交 c82021cebfc68c2ec5eb9a64b37e976969f033e4。
- 手动工作流 .github/workflows/ios-prototype.yml 已上传，尚未确认启动，尚无 IPA。
- ios-build-validation 分支已创建；新增 PR 自动触发被自动审批拒绝（扩大自动执行范围和额度消耗），未上传，本地已撤回；保持 workflow_dispatch。
- GitHub 连接器没有 workflow dispatch 工具，Chrome 与内置浏览器控制均超时。需要用户在 Actions 页面手动 Run workflow，提供运行链接后继续读取构建日志并修复。
- 三站和 iPhone 锁屏下载仍未验收，维持原型状态。

## iOS 首次云构建诊断（2026-09-09 13:28）
- run 34313648806 失败于模拟器测试；Swift/C 编译、FFmpeg 构建均成功。4 项原生测试中 3 项通过，AES 错误密钥断言未抛异常。
- 下载诊断包到 .tools/ios-diagnostics.zip，提取 .tools/simulator.log、packages.log。附件下载需 User-Agent Mozilla/5.0，否则 Cloudflare 1010。
- 修复：CommonCrypto 无填充解密后显式严格验证 PKCS7；新增超范围、零长度、不一致填充向量，Node 独立验证三个向量均应拒绝。仍需 macOS 原生重测。
- package-ios.sh 用 tee 同时保留文件和可通过连接器读取的 Xcode 日志。
- main 修复提交 7e8b303d0da74c8c79a7f0ea4552fa9211f787d1。需要对 main 新建 workflow_dispatch 运行，不能 Re-run 旧提交。
- CUA 读取已登录 iab 页面仍超时。自动跟进 ios-ipa 每 10 分钟；待用户新运行链接，尚无 IPA。

## iOS 第二轮云构建（2026-09-09）
- run 34316796277 / job 102354597616：7 项 HLS 核心测试及 4 项原生测试全部通过（包括严格 AES 填充）；iPhone Release ARCHIVE SUCCEEDED。
- 失败位于归档后的 lipo -verify_arch 参数顺序：文件名被当成架构参数。改为 lipo <binary> -verify_arch arm64。
- Git Bash -n 语法检查通过；修复已上传 main 提交 1464a12463025204eeac5b9035e2ce573701c12a。需要 main 新一轮 Run workflow；仍无已交付 IPA，真机和三站验收未完成。

## iOS 第三轮打包错误修复
- run 34318214410 / job 102358867588：归档、架构及 Bundle 布局检查成功。package-ios.sh 最末第 36 行出现单独 CR，退出 127，导致上传跳过。远程文件证实尾部为 LF CRLF，由上次 Get-Content 输出直接上传引入。
- main 已清除 CR，并加脚本换行预检；已生成 IPA 即使后续步骤失败也会上传。最新提交 4eb22587da78342119374d6ac218b3dfcaca8c98。
- 回读远程 package-ios.sh 确认 CR=0，Git Bash -n 通过。今后上传用 Python JSON 文件内容，不能把 Get-Content 的终端输出直接用作内容。
- 尚未获取 IPA 产物，需新 main Run workflow。


## iOS 原型 IPA 已交付到本地
- run 34319138718 / job 102361709098 全部成功，7+4 项测试通过。
- release/ios/StreamHarbor-iOS-unsigned.ipa，2043180 字节，SHA256 30f56bef61004086b3d244a8a088166c19700c674b93a6cbde38937cca0d8673。ZIP、arm64、iOS17、Web资产及双层哈希均核验通过。
- 安装和验证说明已更新，下一门槛为用户真机侧载及三站验证；不进入第二阶段。


## 用户首轮安装测试反馈与计划同步
- 来源：用户最新消息“目前构建已成功，我已安装测试，给出的三个校验站点都不能解析，且下载记录没有删除功能”。
- task_plan.md：更新构建/安装完成项，登记 P0 三站解析失败、P1 记录删除缺失，保留三站全流程门槛。
- findings.md：区分云端已验证事实、用户真机反馈与尚未知根因，纠正早期未上传状态。
- progress.md：增加当前状态及此次更新记录；历史构建失败和修复证据保留。
- 尚未执行三站故障复现或删除功能修复；详细错误、机型/iOS、自动/手动识别结果待后续收集。
