# Progress

## 2026-09-29 内置搜索窗口广告过滤
- 已核对指定列表大小、格式与 Electron 会话隔离；开始接入规则引擎和启动更新缓存。
- 已接入 Ghostery Electron 引擎，仅绑定 Google 与 DuckDuckGo 共用的搜索会话；每次启动更新指定规则，成功版本写入应用数据目录，失败沿用缓存。
- 41 项测试、类型检查、开发与打包目录各 26 项 Electron 冒烟通过，包含本地广告脚本拦截、页面元素隐藏、更新 503 回退；成品客户端真实下载指定规则 5,346,117 字节。安装包和便携版已生成。

## 2026-09-29 内置网页搜索窗口
- 已核对外部浏览器调用和站点访问窗口实现，开始切换至内置 BrowserWindow。
- 41 项测试、Vue 类型检查、开发和打包目录各 25 项 Electron 冒烟通过；两个网页搜索按钮均实际打开内置窗口并复制网址。
- 重新生成安装包与便携版；便携版构建时旧同名文件被运行中的进程占用，先以新文件名生成，用户关闭进程后核对 SHA-256 并覆盖标准文件名，临时副本已清理。

## 2026-09-29 移除 LibVio 与手动网页搜索
- 已核对站点配置、Stui 代码与搜索发现界面；开始实现旧配置迁移和外部浏览器搜索入口。
- 完成站点迁移、Stui 代码移除、网页搜索 UI 与 IPC；41 项测试、类型检查、开发和打包程序各 25 项 Electron 检查通过。
- 更新 `windows/README.md` 和 `windows/VALIDATION.md`，重新生成安装包与便携版。

## 2026-09-29 任意任务记录删除
- 已核对主进程任务状态、worker 停止流程、加密存储、临时目录以及站点适配器边界；开始实现逐条删除。
- 已实现任意状态逐条删除、加密凭据同步移除和运行任务停止；完成视频保留。界面及 README 已说明站点适配器只适用于对应页面结构。
- 36 项测试、Vue 类型检查、开发与新打包目录的 22 项 Electron 回归通过。更新安装包和改名便携版已生成；直接便携版 UI 自动化受启动连接限制，未计通过。详见 `windows/VALIDATION.md`。

## 2026-09-29 搜索与队列修复
- 已读项目计划、现有站点适配器及现场验收记录，定位 UI 生命周期、响应式数组 IPC、封面和队列排序原因。
- 已修复并重建 Windows 前后端：单站过滤参数克隆、相关性过滤、封面站点会话读取、行内剧集、菜单返回保留结果、最新任务置顶与稳定持久化、失败状态保留。
- 36/36 核心及站点测试、Vue 类型检查、开发与打包程序 19 项 Electron 回归通过。SOTVLA 用户指定链接直接粘贴与搜索批量两条路径均已下载首片；同名另一来源无剧集。
- 已生成 Windows 安装包与便携版，SHA-256 和验证边界见 `windows/VALIDATION.md`。隔离 smoke 临时数据已清理。

## 2026-09-29 Windows 搜索发现
- 已读取用户开发计划、项目历史及现有 Windows 架构。开始实施；尚未宣称三站搜索、解析或整片下载通过。
- 已完成站点配置/导入导出、三站独立适配、跨站分页搜索、线路/剧集选择、批量延迟解析、持久化会话与人工访问窗口。
- 自动化 35/35 通过；新增毒舌适配后的最终打包与 19 项打包程序冒烟通过，包含人工访问 Cookie 会话、无应用 preload、嵌套播放器 Referer 和批量任务明文边界。
- 真实站点：大米星球一集 323,664,128 字节、SOTVLA `api_id=20` 一集 439,969,480 字节、毒舌首条线路一集 431,404,811 字节完整下载和深度校验通过；SOTVLA 另外两来源 HTTP 404。详见 `windows/VALIDATION.md`。

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
# 2026-09-29 四站适配

## 2026-09-29 搜索体验与站点维护
- 已读取现有搜索视图、站点持久化和 LibVio 解析路径，开始核对真实页面。
- 完成代码、持久化迁移和 UI 冒烟；41 项测试、类型检查通过，开发版及打包目录各 23 项 Electron 检查通过。
- 原生 Electron 截图片名搜索及详情通过；媒体探针无候选，未做整片下载。
- 已生成 `windows/release/StreamHarbor Setup 1.0.0.exe` 与 `windows/release/StreamHarbor 1.0.0.exe`。

- 已恢复三份项目记录，读取 `prompt-optimizer` 与 `planning-with-files` 技能和现有 `sites.ts`。
- 待执行：原生 Electron 五站探查、实现、回归。
- 原生 Electron 首轮取证完成四站首页/播放页，星河看超时；首轮沙箱内 GPU 启动失败，获准环境启动成功。已启动搜索和详情补充探针。
- 搜索和详情补充探针完成。确定 `stui`、`myui`、`vod` 三组，开始实现；星河看保持未适配状态等待可访问页面证据。
- 用户提供 `xhkan.cc`，该网址是线路发布页；`xhkan2.top` 与 `xhkan3.top` 均需滑块验证。用户随后明确要求不处理星河看，已从最终预置列表移除。
- 已实现 LibVio Stui、片库独立 vod 布局、绿色影视/嘀嗒共用 Myui，以及旧配置一次性补入四站。四站原生 Electron 搜索/详情均通过。
- LibVio 发现 MP4 候选，绿色影视与嘀嗒发现 HLS 候选；片库两条同名结果没有媒体候选，播放页导航有超时。未做整集下载。
- 39 项核心/站点测试、Vue 类型检查、打包程序 22 项 Electron 冒烟通过；安装包和便携版已生成并核验哈希。


## 2026-09-30 Chrome 扩展修复
- 已读取 extension 源码和构建配置，开始修复；原有 Windows/iOS 工作记录保留。
- 环境 node 可用，npm 不在 PATH，构建将直接调用已安装 Vite。

## 2026-09-30 Chrome 扩展完成记录
- 修改 extension 的媒体分类、捕获上下文、后台/offscreen 直链下载、popup 状态、manifest、构建、说明与浏览器回归脚本。
- node TypeScript 和 vue-tsc 检查通过，Vite 最终构建通过，浏览器 6 组回归通过，证据 extension/browser-validation.json。
- 测试使用隔离 profile 与工作区内下载目录；测试 profile/下载夹具随测试清理。Chrome for Testing 临时运行时在验收后删除。
- 尚未验证用户原 Chrome 中 LibVio 整集下载。请重载扩展、刷新并播放页面，重新捕获再下载。

## 2026-09-30 完整性提示复查
- 修正长度来源、缓存模式和 fragment 去重；准备 gzip、chunked 无长度头/候选大小不符、部分 206、真实截断的实际浏览器回归。

## 2026-09-30 完整性复查完成
- 最终 extension/dist 已构建，9 组浏览器检查通过，用户指定视频完整落盘 934277489 字节，H.264/AAC/时长元数据有效。
- 已更新 README 与 browser-validation.json；临时测试文件和独立 profile 由测试脚本清理，临时 Chrome for Testing 运行时验收后删除。
- 用户重载 StreamHarbor 并刷新播放页即可加载此修正版本。

## 2026-09-30 跨页面进度修复
- 已恢复项目记录并核对后台任务与 popup 渲染关系，开始实现全局任务列表。

## 2026-09-30 任务控制进展
- 全局任务列表和暂停/继续/重试/取消/打开文件/显示文件夹/移除记录已实现。
- TypeScript/Vue 检查、最终 Vite 构建通过；13 组受控浏览器回归通过。正在用用户指定 LibVio 整集验证真实暂停/继续和最终落盘。

## 2026-09-30 跨页面任务及按钮完成
- 最终构建与类型检查通过；14 组浏览器验收通过，包括切换页面显示、实际暂停/继续、安全重下、取消/重试、保留文件的记录移除和用户 LibVio 整集落盘。
- extension/dist、README 和验证报告已更新。临时测试 profile/视频由脚本清理，Chrome for Testing 临时运行时随后清理。

## 2026-09-30 真实弹窗生命周期复查
- 正在补充工具栏 popup 和 worker 重启验收，既有真实 LibVio 验收报告保留。

## 2026-09-30 1.0.1 持久任务修复交付
- 真正 toolbar popup 8 项验收通过，含 worker stopped 状态核对、下载途中重启后完成事件、缺失 offscreen/DNR 后重新获取、落盘字节一致。
- 13 组常规控制回归通过，类型检查/最终构建通过，版本号 1.0.1。
- 新增 popup-lifecycle-validation.json 和 popup-lifecycle-preview.png；原真实 LibVio 大文件报告保留，本轮不重复整集下载。
- 临时 Chrome for Testing 运行时与 profile/测试视频在验收后清理；交付目录 extension/dist。

## 2026-09-30 1.0.2 修复开始
- 已恢复三份记录；用户具体媒体类型待答复，已确认 HLS 路径存在与症状一致的生命周期缺陷。

- 1.0.2 构建、TypeScript/Vue 类型检查通过，13 组 MP4/WebM 常规浏览器回归通过。HLS 真正工具栏生命周期回归运行中。

## 2026-09-30 1.0.2 完成
- 修改 extension 的 core/downloader、core/hls、offscreen/hls 与 index、background/downloads 与 index、popup/App、版本字段、README、工具栏回归脚本。
- 类型检查和 Vite 最终构建通过；常规浏览器 13 组与真实工具栏 17 项通过，包含 HLS 9 项。报告 popup-lifecycle-validation.json、hls-lifecycle-validation.json、browser-controls-validation.json。
- extension/dist 和 artifacts/StreamHarbor-extension-1.0.2.zip 已生成，ZIP 根 manifest 版本和后台/popup/offscreen 入口核验通过。
- 测试临时 profile/下载夹具由脚本清理，本轮临时 Chrome 运行时也已清理。1.0.1 历史 ZIP 和真实 LibVio 报告保留。

## 2026-09-30 扩展批量开始
- 已恢复记录、读取现有 popup/background/content 与 Windows Myui 参考；待浏览器站点验证和实现。

- 源码与 UI 接入完成，TypeScript/Vue 类型检查通过，1.0.3 已构建。准备真正 popup 的角标/全选/线路/批量/worker 恢复和实际 128 集页面验证。

- 真实指定剧集前两集批量下载、落盘和 FFprobe 已通过；正在最终 UI 整理、构建和 ZIP 核验。

## 2026-09-30 1.0.3 交付完成
- 新增 core/series.ts、background/badge.ts、background/batch.ts、scripts/test-series.cjs；更新 shared/types、content、background/index/downloads、popup、manifest、版本及说明。
- 5组最终真实 popup 批量集成通过，包含旧每标签角标覆盖迁移；之前13组常规和17项生命周期通过。
- 用户指定 /movie/93518.html 128集列表与前两集实际批量完整落盘、FFprobe通过；独立证据 series-live-validation.json，series-live-preview.png。
- 最终 ZIP 根 manifest/权限/入口、60146字节和 SHA256 已核验；已清理所有本轮临时 profile/夹具/运行时与崩溃残留，不修改用户 Chrome 或原发布包。

## 2026-09-30 首尾播放页范围批量下载
- 用户要求将自动识别入口改为首集/末集链接输入。生成连续播放页，逐集入槽解析媒体，不递增视频签名地址。
- 同源、固定文本和其他数字一致，仅一个数字字段变化；拒绝倒序、超过2000集和媒体直链。保留编号补零、0起始与查询参数。
- [x] 首尾输入、可选名称、生成范围/逐集链接预览、多选全选、草稿恢复及后台独立验证完成，版本1.0.4。
- [x] 20项范围检查、6组真正popup批量集成、13组常规回归、17项生命周期、TypeScript/Vue检查通过。受控HLS完整合并落盘字节一致。
- [x] 真实LibVio两集分别解析v.libvio.app的Lanterns.S01E01.mp4和S01E02.mp4并进入下载，随后暂停取消；未完整下载/解码本轮真实两集。
- esbuild范围测试在沙箱访问父目录失败，经批准使用完整环境后通过；真实浏览器测试无需该升级。
- [x] ZIP根manifest1.0.4、权限、四入口和压缩完整性核验通过；交付extension/dist与artifacts/StreamHarbor-extension-1.0.4.zip。
- ZIP SHA256: dc338443cd0641bbcc8756cf27e63ba21dccb156e1b34209ea9a0cd2f4b7bc8a；62019字节。
- 临时 Chrome for Testing 运行时已按核验的绝对路径清理；测试 profile 和下载夹具由测试脚本清理。

## 2026-09-30 juok3 HLS 分片校验失败
- 用户询问绿色影视识别规则：core/series.ts与后台/content读取仍保留，1.0.4界面不再自动展示。
- 排查指定播放页真实清单/分片，依据实际格式修复，不直接去掉媒体完整性校验。
- [x] 真实浏览器证据、实现修复、匹配测试及构建交付（清单重放与上游404的验收边界已记录）。
- [x] PNG结构识别与完整TS包同步校验实现，13项分片检查和20项真实popup/HLS生命周期检查通过。
- 用户追加要求：删除绿色影视专用列表识别，仅保留首尾链接通用批量；已删除Myui discoverSeries、GET_TAB_SERIES/GET_SERIES_CATALOG/ENQUEUE_EPISODES入口与后台专用路径验证，保留通用播放器媒体配置嗅探（player-media.ts）。
- [x] 移除绿色影视专用识别后的构建与类型检查通过，通用媒体嗅探保留。
- [x] 使用现场已抓取清单重放，581个原URI真实远程PNG分片全部下载/规范化/扩展原生落盘；625878132字节，移除69720字节封装；FFprobe H.264 1920x1080/AAC/2802.24秒。未做全片深度解码；当前上游新清单404，不能宣称重开网页的一键整集验收通过。
- 证据：hls-site-probe.json、hls-segment-probe.json、hls-upstream-validation.json、hls-png-live-validation.json；实际文件与临时profile由测试结束时清理。
- [x] 删除专用识别后6组通用批量回归通过；最终1.0.5 ZIP根manifest/四入口/权限/压缩完整性与旧入口移除核验通过。
- ZIP: 61371字节；SHA256 a910908695d2c37cb4902cc28b5187028792b6e7baa28d7e0b516b951d5234a8。
- 本轮临时Chrome运行时、原分片样本目录与一次性探测脚本已按核验的绝对路径清理；保留测试脚本、报告和历史发布包。

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

## 2026-09-30 Chrome 扩展 Meta 支持
- 已读取现有计划/记录并核查平台、content、manifest、构建与下载路径；开始补充平台支持。
- 解析12组与Meta浏览器11组检查通过；常规下载13组通过；正在执行真正popup/HLS生命周期、批量队列与真实平台字段核查。
- 真实Facebook视频完整下载通过；发现Instagram页面已有video_versions但候选未产生，继续诊断实际字段。
- 1.0.7完成。最终70项/组对应检查通过（13解析、12Meta集成、13下载、21popup/HLS、11队列）；真实两站完整原生落盘/FFprobe通过，证据独立保存。
- 包已核验71881字节/SHA256/六入口/webNavigation权限。临时运行时及诊断文件清理完毕；本轮无Git发布或用户浏览器配置变更。

## 2026-10-08 蜘蛛网图标接入
- 完成配置与原图检查，新增 Windows 图标导出脚本，manifest 改为 spiderweb16/32/48/128.png。
- 正在保存 master、导出尺寸、构建并打包。

- 完成 master 保存、Windows 导出脚本、四种尺寸、双图标配置与安装说明。npm run build 成功。
- icon-validation.json 记录四尺寸与六入口、ZIP完整性通过。交付包 StreamHarbor-extension-1.0.7-spiderweb.zip：105076 字节，SHA256 4b4a2d59303cb100428cdba7e6e04cd7a536a5c63e4b93802e8b58e2a9143be3。
- 未在用户 Chrome 中执行安装/重新加载；交付可加载 dist 与步骤。本轮只改图标配置，未重复视频下载回归。未创建需清理的临时文件。

## 2026-10-08 Windows 绿色影视搜索修复
- 已读 feature-dev 与角色说明；定位 Myui 搜索入口并委派只读调用链检查。默认沙箱启动失败，获准 shell 可用。
## 2026-10-08 Windows Instagram / Facebook 支持
- 已读取 feature-dev 与角色说明，委派只读插件解析链路探索；完成 Windows 解析 / 下载 / IPC / 构建检查。
- 默认 exec 与 Node REPL 因 sandbox setup refresh 失败；获准 shell 可用，使用该环境继续。
- 当前无 Git 元数据，无项目 AGENTS.md 文件；依据用户提供规范与本轮文件清单开展工作。
- 主进程专用 Meta 分支、共享提取器、主框架 JSON 观察、平台登录窗口 / IPC / UI 已接入；不降级到任意 CDN 音视频轨道。
- 49 项桌面测试、13 组共享插件解析、类型 / 构建、8 项 Meta Electron 集成、26 项原有 Electron 冒烟通过。
- 独立正确性审查发现旧页面延迟 JSON 归属问题；已在 requestWillBeSent 固定主框架、loader、documentURL 和导航世代，添加真实 Chromium SPA 延迟响应回归；复审通过。
- 首次平台窗口测试未等待导航，修正等待后通过；首次现场脚本用 waitForFunction 读取 Promise 导致任务尚在下载时误判，改为按新任务 ID 轮询稳定状态后通过。
- Instagram 现场完整下载与深度解码通过（918237 字节、4.966667 秒、H.264 480×854）；Facebook 两个样本页面无法打开，未记作下载通过。隔离现场与 Meta 集成 profile / 下载由各脚本清理。
- 新安装 / 便携包放独立 release/meta-20261008，保留历史产物；打包目录8项 Meta 集成、26项原有冒烟通过，SHA-256与大小已记录。
- 截图核验发现测试响应未标 UTF-8 导致夹具中文标题乱码，修正 charset 并加入中文标题检查；打包程序通过。真实页面标题未受此夹具问题影响。
- export-source.py 已保留同级共享源码层级，避免独立源码包缺依赖；交付说明和实际验证边界已更新。


- 已实现 Cloudflare 特征识别和同窗口有限等待；补充长样式验证页/正常 Turnstile 页面回归。一次补丁匹配失败，已用正确上下文重新应用。


- 42 项自动化通过；本地 Electron 的自动跳转/会话/详情/阻断通过，取消断言误用 AbortError，已按既有 TIMEOUT 契约修正重跑。误写 windows 下记录已归并到根目录并清理；计划只保留根目录。

- 42 项最终自动化通过、类型与客户端构建通过；本地原生 Electron 5 项行为验证通过。真实两站搜索和详情通过。已按捕获的原文恢复被旧探针覆盖的历史报告，新结果独立保存；正在生成独立命名发布文件。

- 首次打包失败：构建过程中 dist/ui 被另一构建更新，旧 hash 的 JS 消失（ENOENT）。将改用独立快照目录与输出目录，避免共享 dist/release 竞争。

- 独立快照首轮打包使用 target 宏被 electron-builder 拒绝；已依据本地 nsisOptions 给 nsis/portable 分别设置 artifactName，保留独立快照复跑。独立审查两个发现已复核关闭。

- 独立快照打包通过，成品 26 项既有 Electron 冒烟通过。首次额外真实站点 UI 探针在启动后立即点击导航，未等页面初始化而超时；正在按既有冒烟的等待入口修正。

- 定向成品 UI 探针首次实际为导航按钮含图标导致 exact 名称不匹配；修正后绿色影视结果等待超时。正在保存错误并用最终 app.asar 的无调试连接原生 IPC 验收。

- 已完成：最终 app.asar 无调试连接的真实 IPC 搜索/详情两站通过；26 项成品冒烟通过。调试 UI 的具体错误为安全验证未完成，正确 ACCESS 提示可见，未计真实搜索通过。
- 已核对 setup/portable 两文件尺寸与 SHA256，并更新 README/VALIDATION/计划。独立快照、依赖 junction、一次性探针/打包脚本、原始 HTML 和被 Chromium 暂占的本轮 profile 已按绝对路径清理；保留可复用原生测试和结果证据。

## 2026-10-08 双客户端图标接入
- 完成配置探索，开始生成资源和接入原生/界面配置。用户追加授权 GitHub 云构建 IPA。
- 双端首次构建被 TypeScript 拒绝：项目没有 PNG/Vite 资源模块声明。补充 vite/client 类型后继续。
- Windows 构建/独立打包完成；成品EXE七层图标与源码一致，原生Electron启动/品牌图标解码/媒体工具检查通过。iOS 本地前端通过，18个文件已核对提交blob SHA并触发 run 37761235493，当前编译FFmpeg。
- Windows setup/portable 七层图标资源均与源ICO一致；双端源码ZIP包含原图和生成脚本并通过CRC与所需文件核验。手机390×844前端图标预览通过。已清理本轮Windows打包快照和隔离测试profile，仅删除确认的junction本体，保留原node_modules。
- 云构建 run37761235493成功，22核心+16原生测试/归档/编译后AppIcon检查通过，IPA已下载。额外本地IPA检查假设至少两个直接PNG文件而失败，正在查看Assets.car与实际打包文件布局。

- iOS run37761235493成功，22核心+16原生测试、编译后图标配置检查和arm64归档通过。下载IPA8524659字节，SHA256 9958fedadb23ac9b74e6fd49682c6a7b0214a108280c7182a2990d30b8bf0ba8，无损解码图标逐像素一致。Windows和iOS双端图标接入/构建/交付均完成。
- GitHub最终证据文档提交194d5247；更新双端源码包。已将必要云构建证据保存到发布目录，并清理本轮API临时文件、远端比较副本和原始构建日志；保留发布包、原图、生成脚本与验证报告。

## 2026-10-09 三端说明核对
- 已读取 RTK 与 planning-with-files；工作区无 Git 元数据，未找到项目 AGENTS.md。
- 已核对三端 README、package.json、部分验证报告及 iOS 云构建工作流。
- 工具错误：默认 exec 两次、Node REPL 一次均因沙箱初始化失败；获准 shell 可用。一次并行调用参数组织错误，已修正为参数对象后执行。

- 核对源码和发布包完成。读取ASAR第一次用正斜杠找条目失败，改为listPackage提供的Windows条目路径成功。目录清单中extension/artifacts不存在，已定位报告实际在extension根目录。

- 已更新总览、三端README/验证说明和最新iOS发布目录的安装/验收材料，共9份文档；扩展历史版本段落原样移到VALIDATION.md并标注历史行为。
- 一次函数脚本因Markdown围栏的反引号与JavaScript模板字符串冲突而未执行，改用分批数据与Python写入；文件写入已成功。首次文档验证因Windows默认GBK读取package.json失败，改用显式UTF-8后重试。

- 完成9份说明文档更新，检查68个本地链接、30处命令入口、版本/构建号、4个包的SHA-256与大小、ZIP/IPA CRC，全部通过。扩展历史记录逐字保留；当前记录删除操作表和原生测试覆盖均已按源码修正。
- 本轮仅修改Markdown说明及根目录工作记录；没有执行客户端构建、云端发布或真实站点下载。最后清理本轮.tools/docs-audit-20261009临时备份与校验摘要。

## 2026-10-11 Windows 修复
用户授权修复全部9项。模块并行编辑范围已隔离；主审负责main.ts和测试入口。保留历史发布产物。

完成：77/77回归、类型检查及构建、26项桌面冒烟、真实Electron隔离回归均通过。新增测试先红后绿；test runner已接入。主审重复验证真实Electron测试通过，未更新历史release。初次文档补丁因锚点不匹配未应用，读取标题后已修正。沙箱内esbuild读取父目录受限，经自动审批在沙箱外完成测试/构建。

## 2026-10-11 Windows 1.0.1 本地交付
已升级package/lock/UI为1.0.1，构建NSIS与portable到release/1.0.1。打包版26项冒烟、ASAR与dist哈希一致性、两个EXE内嵌ASAR及7z完整性通过。删除13项旧包/解包目录/发布ZIP/日志，4,115,894,955字节。保留源码、验证记录、扩展与iOS产物。首次ASAR读取使用正斜杠失败，改为本机路径后通过；7zip-bin模块不存在，使用已配置builder-cache中的7za.exe验证通过。

## 2026-10-27 GitHub 同步核查（进行中）
已读取发布配置、忽略规则及历史记录；接下来逐文件核对远端 main，按用户指定条件提交或发布。

提交前验证：Windows77项测试、类型检查、UI/主进程构建；扩展类型检查、20项范围+13项TS分片+13项Meta检查及构建；iOS前端构建及10项解析测试全部通过。测试证书临时生成及TLS上下文校验通过；待上传文本凭据扫描未发现匹配。未运行iPhone真机测试或完整扩展浏览器回归。错误：系统Node路径和esbuild父目录遭沙箱限制，改内置Node并获准完整环境；系统OpenSSL缺默认配置，测试改用临时最小配置。
