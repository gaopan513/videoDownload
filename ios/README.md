# StreamHarbor iPhone 原型

当前源码与本地 IPA 为 1.0.0（构建号 11），最低 iOS 17，应用标识 local.streamharbor.ios。手机 AppIcon 与界面品牌使用蜘蛛网视频图标。本说明于 2026-10-09 按源码、工作流和保存的云构建证据核对。

[Actions run 37761235493](https://github.com/gaopan513/videoDownload/actions/runs/37761235493) 已完成 22 项核心、16 项原生测试与 iPhone arm64 归档。当前 [未签名 IPA](release/spiderweb-20261008/StreamHarbor-iOS-unsigned.ipa) 位于 release/spiderweb-20261008/；[安装材料](release/spiderweb-20261008/INSTALL.md)、[云构建证据](release/spiderweb-20261008/cloud-build-evidence.txt) 和 [图标校验](release/spiderweb-20261008/icon-validation.json) 保存在同目录。构建号 10 的旧包不含新图标。

IPA 为 8524659 字节，SHA-256：9958fedadb23ac9b74e6fd49682c6a7b0214a108280c7182a2990d30b8bf0ba8。构建与图标核验已通过；签名更新、iPhone 桌面图标、目标站点整片下载与后台流程仍待真机确认，见 [VALIDATION.md](VALIDATION.md)。

## 安装与使用

在 Windows 上使用 [Sideloadly 官方工具](https://sideloadly.io/)，按工具说明准备设备驱动，将 iPhone 连接并信任电脑，导入未签名 IPA，用自己的账号签名安装。按设备提示信任开发者并启用开发者模式，签名到期按侧载工具说明续签。账号凭据仅在本机侧载工具中输入，工作流不需要 Apple ID 或开发者证书。

1. 输入单个视频网页、MP4 或 M3U8，点击“解析链接”。
2. 自动识别失败时点击“打开网页识别”，手动播放并完成验证，再点击网页窗口的“完成识别”。暂无媒体时可在同次运行的识别会话中继续操作后重试。
3. 选择候选和保存方式，可勾选“完成后逐帧解码校验”，再点击“下载到手机”。无法确认编码时界面会询问是否尝试。
4. 在下载队列暂停、继续或取消；失败任务可修改保存方式后重试，复用仍有效的已完成分片。
5. 下载完回到前台封装或转码，再分享/存储到“文件”；MP4 可尝试“存到相册”，保存前会检查系统兼容性。

当前界面没有样本按钮、站点搜索或剧集批量入口；测试链接按验收表填写。“删除记录”仅对已完成或已取消任务显示，保留已完成视频；其他任务需先取消，不提供一键清空完成记录。

## 媒体与输出

| 保存方式 | 实现范围 |
| --- | --- |
| 无损 MP4 | 视频 H.264、HEVC、AV1、MPEG-4 Part 2；音频 AAC、MP3、AC-3、E-AC-3、ALAC |
| 无损 MKV | 保留源编码，由 FFmpeg Matroska 封装检查，可容纳 VP9/Opus 等组合 |
| 转码 MP4 | 本版媒体库可解码的内容转为 H.264/AAC；视频使用 Apple VideoToolbox，音频使用 FFmpeg AAC |

相册兼容性与可下载/可封装范围不同；MKV 使用“分享/存储到文件”。默认快速检查编码与时长，可选完整解码；长片转码性能和锁屏行为待真机确认。

支持非 DRM、带 ENDLIST 的有限 HLS：主清单、TS/fMP4、初始化片段、字节范围、独立音轨、AES-128 显式/隐式 IV、密钥轮换，以及 DISCONTINUITY 不连续时间轴。保留清单中声明零时长的分片。不接受直播、DASH、SAMPLE-AES、SESSION-KEY 或 GAP 缺失分片。服务器实际返回 404 的分片无法靠封装或转码恢复。

网页识别使用通用网络、视频元素与页面线索捕获；没有桌面或扩展的专用平台支持承诺。捕获会过滤部分广告/统计请求，按 video、fetch/XHR、资源时间线的证据强度排序，同路径签名变体合并探测；误过滤与复杂页面兼容性仍需真机反馈。

## 下载、后台与文件

默认同时 2 个任务，每任务最多预提交 24 个请求，每主机连接上限 6；预提交量不等于实际并发连接数。解析候选最多 12 个，以 4 路并发展开。MP4 在服务器通过 206/Content-Range 探测且大小适合分段时使用 8 MiB 字节范围分段；最低 16 MiB，超出分段计划上限或探测失败时回退整文件。

HLS 前台使用普通 URLSession，退后台后由系统后台会话接管未完成分片；MP4 使用系统后台下载任务。系统可能延迟后台调度；任务丢失后未完成的整文件请求可能从头下载。合并、解密与转码在前台进行；锁屏测试、前后台切换、认证和系统终止后的恢复仍待真机验收，强制退出不保证持续传输。

暂停/失败保留临时数据，取消删除本任务临时数据。进程重启后，部分完成的 HLS 先恢复为暂停；继续前重新校验播放列表和密钥，不能确认一致时保留旧数据并要求重新下载。分片索引保存和启动哈希检查移至后台，显示接收量、平均速度、已完成段数及长时间无字节提示；未宣称真机提速倍数。

完成视频保存在“文件 → 我的 iPhone → StreamHarbor”。删除记录保留视频；卸载应用会删除应用内文件，需先导出到其他位置。签名到期先续签，避免通过卸载恢复。

任务数据库使用 AES-GCM 加密，密钥保存在 Keychain；临时媒体由 iOS 文件保护管理，未额外加密。完成/取消后清除任务中的媒体 URL、Cookie 和解密密钥。第三方网页只能报告候选，不可调用下载、导出和任务管理桥接；分享和相册权限在点击时请求。

## 开发与云构建

以下命令在本目录 ios/ 运行；保留仓库根的 .github/workflows/ios-prototype.yml。

~~~powershell
npm ci
npm run build
node --test scripts/test-ios-resolver.mjs
npm run dev
~~~

Windows 可构建前端与运行 JS 回归；浏览器只显示界面预览，原生按钮禁用。Swift/Xcode 编译、模拟器原生测试和 IPA 归档需要 macOS。可选 python scripts/check-ios-source.py 需要 tree_sitter 与 tree_sitter_swift，只检查语法树、plist 和夹具哈希，不替代编译。macOS 核心测试入口为 swift test --package-path ios/Core。

[手动工作流](../.github/workflows/ios-prototype.yml) 名称为 iOS prototype IPA，只由 workflow_dispatch 触发：

1. 在 Actions 选择该工作流，点击“Run workflow”。
2. 工作流按配置使用 macOS 15/Xcode 26.3、Node 24.19.0、Capacitor 8.0.0、XcodeGen 2.44.1、FFmpeg 7.1.1、dav1d 1.5.1；依赖和媒体源码摘要固定。
3. 构建前端与 JS 回归，核验夹具；运行 Swift 核心测试，构建媒体库和 XcodeGen，执行模拟器测试后归档 arm64 IPA。
4. 完整运行成功后下载 StreamHarbor-iOS-prototype，包含 IPA、SHA256SUMS.txt、安装/验证说明、媒体源码与重链接材料。该 artifact 保留 14 天；失败诊断 ios-build-diagnostics 保留 7 天。以运行最终结果为准，不能只看 artifact 存在。
5. 不上传 node_modules、.tools、release、测试临时目录或真实站点会话。

本地 macOS 全量构建顺序以工作流和 scripts/package-ios.sh 为准。夹具位于 ios/Tests/Fixtures；准备 FFmpeg 后可运行 node scripts/ios-fixtures.mjs 重新生成，并提交更新的校验值。

工程路径：ios/Core 为独立 Swift 包；ios/Native 为解析、网络、持久化、后台队列及媒体桥接；ios/App 注册 Capacitor 插件和 AppIcon。图标由仓库根 scripts/generate-app-icons.ps1 -Target iOS 从扩展原图导出，AppIcon 使用不透明 RGB PNG。

当前包含 0.2.2(7–9) 的分段下载、持久化/恢复优化、并发解析和捕获过滤；历史修复证据见 [FIX-VALIDATION.md](FIX-VALIDATION.md)、[FIX-0.1.2-VALIDATION.md](FIX-0.1.2-VALIDATION.md) 及根目录开发记录。完整设置、底部导航、完成记录批量清理和公共 Bridge 整合尚未进入阶段二，仍以三站真机门槛为前置条件。第三方许可见 [THIRD_PARTY.md](THIRD_PARTY.md)；其他端见 [Windows](../windows/README.md)、[浏览器扩展](../extension/README.md)。
