# StreamHarbor 浏览器扩展

当前版本 1.0.7，基于 Manifest V3。通过网络请求、DOM 视频元素及播放器配置捕获网页媒体，在后台文档中下载；无需安装本地 FFmpeg。工具栏与管理页使用蜘蛛网视频图标。

本说明于 2026-10-09 核对。当前使用方式以本文为准；各版本的历史行为和验收证据见 [VALIDATION.md](VALIDATION.md)。

## 安装与更新

可直接使用 [dist/](dist/)，或解压仓库根目录的 [StreamHarbor-extension-1.0.7-spiderweb.zip](../artifacts/StreamHarbor-extension-1.0.7-spiderweb.zip)。ZIP 根目录含 manifest.json，不能直接作为已解压扩展加载。

1. Chrome 打开 chrome://extensions/；Edge 打开 edge://extensions/。
2. 开启“开发者模式”，点击“加载已解压的扩展程序”，选择直接包含 manifest.json 的目录。
3. 在工具栏固定 StreamHarbor；打开弹窗确认顶部为 v1.0.7。
4. 更新已有 dist 后，在扩展管理页点击“重新加载”，再刷新播放页并重新播放、捕获。重新加载会释放后台内存数据；已有任务记录可保留，但可能需要重新获取视频。

主要浏览器验收使用 Chrome for Testing；Edge 兼容性未单独验收。

需要从源码构建时，在 extension/ 运行：

~~~powershell
npm ci
npm run typecheck
npm run build
~~~

## 当前页面捕获

每次打开弹窗默认进入“当前页面捕获”，另外两个页面是“剧集批量下载”和“下载任务”。页面切换保留输入与状态，内容独立滚动。

打开视频网页并播放，再点击扩展图标查看捕获列表；按资源选择清晰度并下载。图标角标显示当前浏览器标签页捕获的资源数，不显示全局下载数，也不计入仅在弹窗手动添加的地址。网页主框架刷新、导航或 history 变更后重新捕获；切换弹窗内部页面不会清空捕获。

手动输入接受 Bilibili 视频页、Instagram/Facebook 视频分享链接，以及 MP4/WebM/M3U8 直链。普通网页应先打开并播放后捕获；扩展没有任意网页网址的通用手动解析器。

| 平台/类型 | 实现范围 | 验证边界 |
| --- | --- | --- |
| Bilibili | BV/AV 视频页 API 解析，使用接口返回的 durl 直链 | 裸 BV/AV 号不作为网址解析；b23 短链虽能识别域名，当前解析器不展开重定向；真实 B站下载未验收 |
| Instagram | 视频帖、Reel/Reels、TV、视频分享链接及轮播视频 | 提取页面返回的完整 MP4；公开 Reel 样本完整落盘并通过 FFprobe |
| Facebook | 视频页、Watch、Reels、share/v、share/r、fb.watch | 提取 SD/HD 与 progressive 数据；公开视频样本完整落盘并通过 FFprobe |
| 普通 MP4/WebM/HLS 页面 | 网络、DOM 和播放器配置捕获 | 兼容性取决于页面及媒体格式；不代表所有网站可下载 |
| 其他平台 | 暂无专用解析器 | 可尝试通用捕获，未逐站验收 |

Instagram/Facebook 手动解析会复用已打开的对应视频页，或在当前浏览器会话中创建后台标签页。失败时保留新页面，供登录、验证或播放后重试；成功后关闭本次创建的解析页。只接收已知完整视频字段，保留 CDN 签名并去除播放范围参数；仅有 DASH 分离轨道时提示不支持合并。视频是否含音频取决于平台提供的资源。

## 首尾播放页批量下载

在“剧集批量下载”填写同一作品、同一线路的第一集和最后一集播放页链接，作品名称选填。点击“生成剧集列表”，核对编号和链接，按需全选或取消选择，再点击“下载所选 N 集”。

例如首集 https://www.libvio.io/w/714893650-3-1.html，末集需使用同作品、同线路的实际末集播放页。此例说明网址结构，不能保证该站当前可访问。

首尾网址必须同源、结构相同，只有一个连续数字字段不同；支持 0 起始、前导零和路径/查询参数编号，单批最多 2000 集。拒绝跨站、多个数字变化、倒序、不一致的补零格式以及媒体直链。当前入口不读取绿色影视/Myui 的站点剧集列表。

后台默认同时处理 2 个任务，其他任务排队。每集进入槽位后独立打开播放页，捕获当时的真实媒体地址；不会递增带签名的视频 URL。生成列表只证明编号结构有效；页面验证、编号跳跃或捕获失败仍会使对应任务失败。重试会重新解析播放页。

草稿会保存；关闭弹窗重开后需重新生成列表。“清空输入框”同时清除首尾链接、作品名称、生成列表、选择和错误，并保存空草稿。

## 下载任务与保存位置

“下载任务”显示全部页面的后台任务；关闭弹窗、切换标签或关闭原播放页后仍可查看。排序为解析/准备/下载、排队/暂停、失败/取消、完成；排队按加入顺序，其余组优先显示较新任务。

| 状态 | 可用操作 |
| --- | --- |
| 解析/准备/排队 | 取消 |
| 下载中 | 暂停、取消（按保存阶段的可用按钮操作） |
| 已暂停 | 继续、取消 |
| 失败/已取消 | 重试、移除记录 |
| 已完成 | 打开文件、显示文件夹、移除记录 |

任务记录保存在 storage.local。暂停保留后台内存中的直链数据或已完成 HLS 分片；取消停止请求并释放暂存数据。直链支持 Range 且资源标识一致时续传，不能证明一致时重新获取整文件并显示原因。HLS 继续时复用仍在内存的分片；失败重试可能重新下载。

service worker 重启后可恢复任务状态和完成事件；浏览器重启、扩展重新加载或后台文档丢失会释放内存，不能保证原下载进度可续传。“清空已完成记录”仅移除完成卡片，保留文件及其他状态任务；逐条移除记录也不删除已保存视频。

单文件使用 saveAs:false，保存到浏览器默认下载目录。批量文件位于其中的 StreamHarbor/作品名称/线路_集名.ts（MP4/WebM 使用对应扩展名）。浏览器若开启“下载前询问每个文件的保存位置”，仍可能询问；需要连续自动保存时在浏览器设置中关闭该选项。

## 媒体能力与限制

- MP4/WebM 保存前检查 MIME、文件头及可验证的本次响应长度，拒绝网页、截断和不完整的 206 响应；Chrome 确认保存完成后才显示 100%。
- HLS 支持主清单清晰度、MPEG-TS、相对地址、AES-128 显式/序列隐式 IV；每任务同时下载最多 6 个分片。PNG 包裹的 TS 按 PNG 块边界去除前缀，再核对全部 TS 同步字节。
- HLS 按清单顺序在内存中合并为 .ts，不转封装为 MP4；不支持 fMP4/初始化片段、字节范围或其他加密方式，也不合并独立音轨。
- 不合并 DASH，不处理 DRM。HLS 不持续刷新直播清单，不提供完整直播录制保证。
- 直链和 HLS 都使用后台内存缓存媒体；大文件会占用相应内存。关闭 popup 不会停止后台任务，但仍需保持浏览器运行。
- 登录、区域限制、失效签名或站点变化可能导致失败。更新/重新捕获不能恢复已失效的上游资源。

## 开发与验证

常规构建只需本目录 npm ci。测试脚本复用同级 windows/node_modules 中的 esbuild、Playwright 和媒体工具；运行测试前在 windows/ 安装依赖，保留仓库目录结构。

不启动浏览器的检查（在 extension/ 运行）：

~~~powershell
npm run typecheck
npm run test:range
npm run test:ts
npm run test:meta
~~~

浏览器检查需先 npm run build，再将 CHROME_TEST_EXE 指向支持命令行加载扩展的 Chrome for Testing 可执行文件：

~~~powershell
$env:CHROME_TEST_EXE = 'C:\path\to\chrome.exe'
npm run test:browser
npm run test:popup
npm run test:series
npm run test:meta-browser
~~~

这些脚本使用隔离 profile 与可控媒体。真实站点检查需另外设置 LIVE_VIDEO_URL/LIVE_SOURCE_URL、LIVE_RANGE_FIRST/LIVE_RANGE_LAST 或 META_LIVE_PROBE/META_LIVE_DOWNLOAD；取证范围见 [验证记录](VALIDATION.md)。npm run test:live-hls 依赖现场保存的清单和远程分片，不是离线回归。

Meta 浏览器测试还需要 OpenSSL（可用 OPENSSL_TEST_EXE 指定路径），每次运行在临时目录生成测试证书与私钥，结束后删除。历史探针报告和预览图只在本地保留。

图标原图为 branding/spiderweb-master.png；Windows 下在本目录执行 powershell -File scripts/generate-icons.ps1，再 npm run build。图标、入口、ZIP 校验见 [icon-validation.json](icon-validation.json)。桌面与手机端说明见 [Windows](../windows/README.md)、[iOS](../ios/README.md)。
