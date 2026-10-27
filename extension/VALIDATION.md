# 浏览器扩展验证记录

当前功能版本为 1.0.7；当前使用与安装说明见 [README.md](README.md)。本文按 2026-10-09 本地保存的报告整理，没有重新访问真实站点或重跑浏览器下载。

## 当前证据

| 检查 | 保存结果 | 报告 |
| --- | --- | --- |
| Meta 提取 | 13 组 | [meta-unit-validation.json](meta-unit-validation.json) |
| Meta 浏览器集成 | 12 组 | [meta-browser-validation.json](meta-browser-validation.json) |
| 常规下载控制 | 13 组 | [browser-controls-validation.json](browser-controls-validation.json) |
| 真正 popup/MP4/HLS/PNG/AES 生命周期 | 21 项，报告版本 1.0.7 | [popup-lifecycle-validation.json](popup-lifecycle-validation.json) |
| 首尾链接队列、三页面、角标、清空 | 11 组，报告版本 1.0.7 | [range-validation.json](range-validation.json) |
| 蜘蛛网图标与交付 ZIP | 图标 RGBA/尺寸、源码与 dist 一致、六入口、ZIP 完整性通过 | [icon-validation.json](icon-validation.json) |

2026-09-30 真实匿名 Chrome 会话的 [Meta 报告](meta-live-validation.json)：Instagram Reel 完整保存 918120 字节，H.264 480×854、4.966667 秒，源数据和 FFprobe 均无音轨；Facebook 视频完整保存 11647988 字节，H.264 720×1280/AAC、61.374708 秒。两者落盘大小与响应声明和收到字节一致；未做全片深度解码。旧 Facebook Watch 样本不可观看；样本成功不能推广为全平台支持。

2026-10-08 图标包 [StreamHarbor-extension-1.0.7-spiderweb.zip](../artifacts/StreamHarbor-extension-1.0.7-spiderweb.zip) 为 105076 字节，SHA-256：4b4a2d59303cb100428cdba7e6e04cd7a536a5c63e4b93802e8b58e2a9143be3。图标变更未重复浏览器下载回归。

## 历史记录的使用方式

以下保留原 README 的各版本记录，描述当时的实现、安装包与验收。1.0.3 的自动剧集列表、全局任务角标，早期顶部任务页和保存对话框已被后续版本替换；历史安装步骤中的版本号及 ZIP 不作为当前安装入口。当前只有首尾播放页批量入口，角标显示本标签捕获数，默认自动保存。

绿色影视 128 集列表及前两集完整落盘属于 1.0.3 自动识别入口的历史验收；不能据此声称当前仍有该入口。LibVio 1.0.4 两集只验证解析和启动，随后暂停/取消；PNG 分片 1.0.5 使用已抓取清单重放、仍访问远程分片，不能当作重新打开网页一键整集成功。

## 直链下载修复（2026-09-30）

- MP4/WebM 保留播放请求的 Referer/Origin，通过 offscreen 后台文档获取内容，再交给 Chrome 保存。Chrome 原生下载不接受 Referer 请求头，单纯直接下载可能得到防盗链网页。
- 保存前检查响应 MIME 和文件头，HTML/错误响应会显示失败。只有 Chrome 确认保存完成才显示 100%；关闭弹窗后直链下载继续，重开可查看状态。
- 文件头预检和完整视频请求禁用缓存。完整性校验使用本次响应的未压缩长度；压缩传输长度、播放时捕获的大小仅作进度参考。真正截断及不完整的 206 响应仍会失败。
- 同一资源不同 `#t=` 播放位置只保留一条候选；长度校验错误会显示实际接收量和本次响应长度。
- WebM 保存为 `.webm`；普通网页网址请先打开并播放后嗅探，手动输入只接受识别到的媒体直链或已有平台解析器结果。
- 此直链路径使用浏览器内存缓存完整文件；大视频会占用相应内存。HLS 从 1.0.2 起也在后台运行，关闭弹窗可继续。

更新后在 `chrome://extensions/` 点击 StreamHarbor 的“重新加载”，再刷新播放页并重新开始播放，重新捕获后下载。

浏览器回归：设置 `CHROME_TEST_EXE` 为支持命令行加载扩展的 Chrome for Testing 路径，运行 `npm run test:browser`。测试使用隔离 profile 和受控 HTTP 媒体夹具，结果保存到 `browser-validation.json`；不代表真实站点整集下载或视频解码验收。

可选真实文件验收：额外设置 `LIVE_VIDEO_URL` 和 `LIVE_SOURCE_URL`，脚本会验证完整落盘大小和 FFprobe 媒体元数据，结果写入同一报告；测试文件和隔离 profile 在结束后删除。

## 下载任务与操作（2026-09-30）

MP4/WebM/HLS 后台任务显示在弹窗顶部“下载任务 / 全部页面”。切换标签页、播放页跳转、关闭原播放页或清空当前页捕获列表，都不会隐藏这些任务。正在下载与已暂停任务排在前面。

- 下载中：暂停、取消下载。
- 已暂停：继续、取消下载。支持 Range 且文件标识一致时从已接收位置继续；缺少标识、不支持 Range 或文件改变时重新获取整文件，界面说明原因。
- 失败/已取消：重试、移除记录。重试使用任务保存的媒体来源信息；过期链接仍需重新捕获。
- 完成：打开文件、显示文件夹、移除记录。移除记录只清除扩展中的任务卡片，不删除视频文件。

暂停会停止当前视频网络请求并保留已接收数据，取消会停止请求并释放暂存数据。暂存数据在后台文档内存中，浏览器重启或扩展重新加载后不能保证保留。HLS 从 1.0.2 起支持以上后台操作，继续时复用已完成分片。

为支持“打开文件”，manifest 增加 downloads.open 权限。更新方式仍是在 chrome://extensions/ 重新加载本仓库 extension/dist。

普通浏览器回归结果写入 browser-controls-validation.json；启用 LIVE_VIDEO_URL/LIVE_SOURCE_URL 后的实际视频验收写入 browser-validation.json。

## 1.0.1 任务恢复与版本确认

1.0.1 顶部固定显示版本号，且始终显示“下载任务 / 全部页面”，即使没有下载任务也显示空状态。后台同步失败会显示错误并保留本地任务，避免静默显示空列表。

任务记录改为 storage.local，弹窗先读取持久状态并监听更新。后台下载完成改为 offscreen 主动发事件，service worker 被停止并重新启动后仍可保存完成结果。任务按实际资源 URL 关联，重新捕获/更换播放时间不会重复启动同一正在下载或暂停的任务。后台暂存丢失时保留记录并允许重新获取完整文件。

安装确认：在 chrome://extensions/ 使用“加载已解压的扩展程序”，选择本仓库 extension/dist；打开弹窗确认顶部为 v1.0.2。若有同名旧扩展，停用旧副本后使用这一份。

真实工具栏弹窗验收：设置 CHROME_TEST_EXE 后执行 npm run test:popup，测试通过 chrome.action.openPopup 产生真正的工具栏弹窗，关闭/换页/重开、强制停止 worker、完成事件和文件字节均单独验证。报告 popup-lifecycle-validation.json，预览 popup-lifecycle-preview.png；13 组常规控制回归仍单独记录。


## 1.0.2 HLS 跨标签页进度修复

1.0.1 遗漏了 M3U8/HLS 路径：分片下载、解密、合并仍在 popup 运行，没有写入全局任务列表。1.0.2 将它们迁至 offscreen，通过与 MP4/WebM 相同的持久任务和完成事件保存进度。

- HLS 点击下载后立即进入“下载任务 / 全部页面”。关闭弹窗、切换标签、返回原播放页或关闭原页，都能继续查看同一任务。
- 暂停保留已完成分片，继续只获取剩余分片；取消释放暂存，失败/取消可重试。选择的清晰度与播放请求来源保存在任务中。
- 支持普通 MPEG-TS HLS 和 AES-128（显式 IV/序列隐式 IV），按原分片顺序合并，Chrome 确认保存完成后才显示 100%。初始化片段、字节范围和其他加密会明确报错，避免导出不完整内容。
- 扩展重新加载或浏览器重启会释放内存分片；任务记录保留，继续时重新获取。1.0.1 已丢失的 popup HLS 任务没有持久记录，无法恢复，需要重新开始下载。

更新：重载 `extension/dist`，或解压 `artifacts/StreamHarbor-extension-1.0.2.zip` 后加载其中的 manifest 所在目录；确认弹窗顶部为 v1.0.2。刷新播放页、播放并重新捕获，然后开始 HLS 下载。

`npm run test:popup` 同时覆盖 MP4 和 HLS 的真正工具栏弹窗生命周期，HLS 独立证据写入 `hls-lifecycle-validation.json`。HLS 使用受控 MPEG-TS 字节夹具，核验清晰度、解密、跨页恢复与落盘顺序；不代表用户原站点整集或媒体解码验收。


## 1.0.3 下载角标与剧集批量下载

图标角标统一显示全部页面正在运行的任务数，包含正在解析剧集、准备和下载中的任务；排队、暂停、完成、失败及取消不计入。没有运行任务时清空角标。切换页面及后台重启后仍按持久任务恢复。

打开绿色影视的剧集详情或任意一集播放页，弹窗中的“剧集批量下载”会读取实际播放线路及全部剧集。选择线路后可多选、全选、全不选，再点击“下载所选 N 集”。后台默认同时运行 2 个任务，其他剧集排队；先保存队列，进入下载槽后再打开播放页解析当前媒体链接。关闭弹窗后继续执行，不需要手动逐集播放。

- 任务提供排队/解析/下载/暂停/失败/完成状态，支持取消、暂停继续和重试；重复提交会跳过已有任务。
- 重试剧集会重新获取当前媒体链接。需要人工验证时在任务中明确显示失败，可打开播放页处理后重试。
- 批量文件自动保存到浏览器下载目录的 `StreamHarbor/作品名称/线路_集名.ts`（MP4/WebM 使用对应扩展名），不逐集弹出保存对话框；手动单文件保存方式保持原样。
- 对 Myui 的 `/movie/<id>.html`、`/play/<id>-<line>-<episode>.html` 页面按真实列表识别同一作品、同一来源的剧集，不猜测连续编号。已实际验证绿色影视，其他页面模板没有剧集列表时提示未识别，并仍允许下载已捕获媒体。
- 为后台队列恢复新增 `alarms` 权限；更新时 Chrome 如要求重新启用扩展，请启用后确认 v1.0.3。

本轮实际验证用户指定作品《心动APP之青梅好感爆了第二季》：识别“高速”线路 128 集，前两集经扩展批量完整落盘，FFprobe 均为 H.264 1280×720 / AAC。第01集 20621908 字节、119.356556 秒；第02集 14608164 字节、111.689889 秒。未验收其余 126 集或全片深度解码。

1.0.3 验收证据保留在 `series-validation.json` 和 `series-live-validation.json`；当前测试入口和真实站点验证变量见下方 1.0.4 说明。


## 1.0.4 首尾链接批量下载

“剧集批量下载”改为输入第一集和最后一集的**播放页**链接，点击“生成剧集列表”后核对编号范围及链接，再点击“下载所选 N 集”。默认全选，也可取消个别集；作品名称选填，用于任务标题及保存文件夹。首尾输入草稿会保存，关闭弹窗重开后可重新生成。

例如 LibVio 第一集 `https://www.libvio.io/w/714893650-3-1.html`，末集填写相同作品、相同线路实际最后一集链接。绿色影视第一集编号为 0，也可按实际末集链接生成。集数是首尾网址编号差加 1；页面显示的第 N 集按此次输入的第一集开始计数。

- 不再依赖站点剧集列表模板，支持路径或查询参数中的一个连续数字字段，包括 0 起始、前导零和跨位数。只在一个数字字段上不同，其他路径、参数和数字必须一致；单批最多 2000 集。
- 输入必须是 HTTP/HTTPS 播放页，拒绝跨站、结构不一致、多个数字变化、倒序、补零不一致和 MP4/M3U8 直链。后台重新生成并验证范围，不能只凭弹窗数据放行。
- 生成的是播放页地址；每集进入下载槽后独立打开页面，捕获真实视频地址及播放来源。媒体签名地址不递增。沿用持久队列、2 并发、角标、取消、重试与后台下载机制。
- 这种方式适用于集数编号连续的网站。编号跳跃、随机标识、需要登录/验证或不能捕获媒体的页面仍可能失败；生成列表不代表这些页面已通过可下载性验证，失败可在任务中查看原因。

更新：重载 `extension/dist`，或解压 `artifacts/StreamHarbor-extension-1.0.4.zip` 后加载 manifest 所在目录，确认顶部为 v1.0.4。

`npm run test:range` 检查范围生成和拒绝条件；`npm run test:series` 验证真正工具栏弹窗的输入、生成、全选/全不选、后台范围检查、持久队列、并发、角标、取消/重试、worker 恢复及 HLS 落盘字节。报告 `range-validation.json`，预览 `range-preview.png`。设置 `LIVE_ONLY=1`、`LIVE_RANGE_FIRST` 和 `LIVE_RANGE_LAST` 可验证真实两集的独立媒体解析及下载启动，随后暂停取消；这与完整整集落盘和媒体解码验收分开记录。

1.0.4 验收：20 项范围检查、6 组真实工具栏批量集成、13 组常规回归、17 项原工具栏生命周期检查及 TypeScript/Vue 检查通过。真实 LibVio `/w/714893650-3-1.html` 与 `-3-2.html` 分别解析 `Lanterns.S01E01.mp4` 与 `Lanterns.S01E02.mp4` 并进入后台下载，随后暂停取消；未完整下载或解码。独立证据 `range-live-validation.json`。


## 1.0.5 PNG 封装的 HLS 分片与通用批量清理

修复剧OK指定资源的分片校验失败：其 `.png` 分片前面是完整 PNG，图片结束后才是 MPEG-TS。下载时解析 PNG 签名及 IHDR/IEND 块边界，精确移除前缀，再检查所有 188 字节 TS 包的同步字节。仅图片、截断响应、网页及中途损坏的 TS 都明确失败，避免保存错误内容。普通 TS、AES-128、暂停/恢复继续使用同一后台处理。此修复不增加 fMP4、字节范围或其他加密支持。

按用户要求删除绿色影视/Myui 专用的剧集列表解析、content/background 消息入口与作品/线路 URL 校验，只保留首尾播放页链接生成的通用批量入口。`player-media.ts` 保留通用播放器媒体配置读取；它是逐集获取真实媒体地址的嗅探机制，不读取站点剧集列表。已有持久任务仍可继续、取消或重试。

更新：重载 `extension/dist`，或解压 `artifacts/StreamHarbor-extension-1.0.5.zip` 后加载 manifest 所在目录，确认顶部为 v1.0.5；失败任务可重试，若播放链接已失效则刷新原页面重新捕获。

`npm run test:ts` 检查 PNG 边界、全部 TS 同步与损坏拒绝；`npm run test:popup` 包含 PNG 封装、AES 解密、关闭弹窗、暂停恢复、后台重启及落盘字节一致。`npm run test:series` 验证保留下来的首尾链接队列。

1.0.5 分片验收：13项 TS/PNG 检查、20项真正工具栏生命周期检查通过。现场抓取《兰香如故》第6集的581分片清单；新清单随后返回404，故用已抓取的清单在本地重放，分片仍按原URI远程获取。581个分片经扩展去封装并完整落盘625878132字节，FFprobe为H.264 1920×1080/AAC/2802.24秒。未完成重新打开页面的一键整集下载或全片深度解码。报告`hls-png-live-validation.json`，上游404证据`hls-upstream-validation.json`。

设置 `CHROME_TEST_EXE` 后可运行 `npm run test:live-hls`；`RECORDED_HLS=1` 使用现场保存的清单重放，仍访问原远程分片。清单及代理URL会失效，此命令不作为离线回归测试。测试下载与profile在结束时清理。


## 1.0.6 三页面、清空操作与默认保存

弹窗改为三个独立页面：当前页面捕获、剧集批量下载、下载任务。每次打开默认展示当前页面捕获；顶部导航固定，内容独立滚动，切换页面保留输入、选择和任务状态。

- “下载任务”页面提供“清空已完成记录”：后台串行处理并一次保存，只删除completed记录；保留下载文件、运行/排队/暂停任务及失败/取消记录。没有完成记录时按钮禁用。
- “剧集批量下载”页面提供“清空输入框”：清空首尾链接和作品名称，同时清除生成列表、选择及错误，保存空草稿；关闭弹窗重开后不会恢复旧输入。
- 删除顶部清空本页列表按钮和对应消息入口。切换弹窗内部页面不会清理网页捕获；浏览器页面刷新/导航时重新捕获。
- 图标角标改为该浏览器标签页捕获的资源数；无资源时不显示数字。各标签分别显示自己的数量，后台重启从session恢复，不显示全局下载数。角标不包含只在弹窗手动添加的直链。
- 下载任务排序：解析/准备/下载→排队/暂停→失败/取消（可重试）→完成。排队按加入队列顺序排列，其他组以较新任务优先。
- 单文件MP4/WebM/HLS改为`saveAs:false`，自动保存到Chrome配置的下载目录；批量仍在该目录下的`StreamHarbor/作品名称`分组保存。Chrome若启用了“下载前询问每个文件的保存位置”，浏览器仍会询问，需关闭该开关才能持续自动保存；扩展未修改Chrome全局设置。

更新：重载`extension/dist`，或解压`artifacts/StreamHarbor-extension-1.0.6.zip`加载manifest所在目录，确认顶部v1.0.6。

验收：11组真正工具栏页面/捕获角标/后台恢复/排序/清空/持久批量测试通过；21项popup生命周期及MP4/HLS原生自动保存测试通过（隔离Chrome默认目录，未强改saveAs或用CDP强制保存路径，浏览器询问开关关闭）。报告`range-validation.json`、`popup-lifecycle-validation.json`；三页预览`ui-captures-preview.png`、`ui-series-preview.png`、`ui-downloads-sorted-preview.png`。

最终13组常规下载回归通过，含跨标签页进度、后台下载、暂停继续、取消重试和完整文件字节验证。报告`browser-controls-validation.json`。ZIP根manifest为1.0.6，四入口、权限、压缩完整性及旧消息入口移除核验通过；SHA256 `f15eee3d4290181840f442f923c99ff84ada3e731f4f485109feef1fd56a512f`。

## 1.0.7 Instagram / Facebook 视频支持

新增页面 JSON、Relay 嵌套 JSON 字符串、Open Graph 以及页面已有 fetch/XHR 响应提取。早期响应捕获脚本仅在 Instagram/Facebook 运行；发送到扩展的是经过 CDN URL 验证的媒体信息。弹窗显示平台及返回的清晰度，手动解析支持短分享链接与已有页面复用。

修复 Instagram 主页面已捕获视频被延迟 iframe 的 `loading` 状态清空的问题：改用 `webNavigation` 的主框架实际导航与 history 状态变化重置。新增该权限，Chrome 更新时可能要求重新启用扩展。

验证：13组提取测试、12组 Meta 浏览器集成、13组常规下载、21项真正 popup/HLS 生命周期、11组批量/角标/导航检查及 TypeScript/Vue 类型检查通过。Meta 受控测试经扩展 offscreen/Chrome 原生完整落盘，每个平台262144字节一致。

真实匿名 Chrome 扩展会话已验证：

- Instagram `https://www.instagram.com/reel/Chunk8-jurw/`：918120字节，H.264 480×854，4.966667秒。页面数据 `has_audio:false`，FFprobe也没有音轨。
- Facebook `https://www.facebook.com/100064305355374/videos/1040750538995454/`：11647988字节，H.264 720×1280 / AAC，61.374708秒。

两者保存大小均与源响应声明长度、任务收到字节一致。未做全片深度解码；公开样本通过不等于所有私密、付费、地区受限或只有 DASH 的视频都可下载。旧 Facebook Watch 样本已不可观看，其失败也保留在报告中。

证据：`meta-unit-validation.json`、`meta-browser-validation.json`、`meta-live-validation.json`。测试profile和下载文件自动清理；测试本地HTTPS证书仅供夹具使用，不安装到系统证书存储。设置 `CHROME_TEST_EXE` 后运行 `npm run test:meta`、`npm run test:meta-browser`；额外设置 `META_LIVE_PROBE=1` 和 `META_LIVE_DOWNLOAD=1` 才访问真实平台并下载公开样本。

更新：在 `chrome://extensions/` 重新加载本仓库 `extension/dist`，或解压 `artifacts/StreamHarbor-extension-1.0.7.zip` 后加载其 manifest 所在目录，确认顶部为 v1.0.7，再刷新视频页重新捕获。

## 蜘蛛网图标（2026-10-08）

工具栏和扩展管理页使用青色蜘蛛网与白色播放符号的新图标，提供 16、32、48、128 像素透明 PNG。版本仍为 1.0.7。

已加载本仓库 `extension/dist`：在 `chrome://extensions/` 找到 StreamHarbor，点击“重新加载”，再从工具栏的拼图菜单固定插件。

首次安装：在 `chrome://extensions/` 开启“开发者模式”，点击“加载已解压的扩展程序”，选择本仓库 `extension/dist`。也可解压 `artifacts/StreamHarbor-extension-1.0.7-spiderweb.zip`，然后选择解压后直接包含 `manifest.json` 的目录。ZIP 不能直接作为已解压扩展加载。

设计原图保存在 `branding/spiderweb-master.png`，通过内置 image_gen 生成，概念为“蜘蛛网捕获视频”。Windows 下运行 `powershell -File scripts/generate-icons.ps1` 可重新导出尺寸，随后运行 `npm run build` 更新构建目录。
