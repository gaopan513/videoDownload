# StreamHarbor iPhone 原型

## 0.2.2 (6) 三站修复候选（2026-09-11）

已完成本地源码修复，尚未上传、尚未构建 IPA；下方版本章节为历史记录。最近交付包仍为 0.2.1(5)。

- 识别窗口在尚无媒体时保留当前页面，提示完成验证或播放后再识别；同次应用运行中重试保留隔离的临时网页会话。
- HLS 保留服务器声明零时长的分片。juok 当前样本第 654 片声明 0，但实际返回包含音视频的 TS，不能跳过。
- HLS 前台使用普通 URLSession，后台仍由固定后台会话接管；切换仅重启未完成分片，已完成文件保留。整文件 MP4 沿用后台会话，避免前后台切换重下整个文件。
- 下载显示接收量、平均接收速度、30 秒无字节时的等待提示，以及最终失败的主机与网络错误码；已知字节范围用于进度分母。

本地通过 7 项 JS 回归、Swift 语法检查、移动端构建；零时长合成 TS 的 Windows FFmpeg 对照保留全部 24 包并完整解码。新核心与原生测试须在 Xcode 执行；真实 iPhone 下载速度、前后台切换及最终输出仍待复测。gaze 当前浏览器为人机验证页，尚未取得验证后播放器证据。

## 0.2.0 (4) 编码支持候选（2026-09-10）

已实现与桌面相同的三种输出选择，待本版云构建和 iPhone 复测：

| 保存方式 | 支持范围 |
| --- | --- |
| 无损 MP4 | 视频 H.264、HEVC、AV1、MPEG-4 Part 2；音频 AAC、MP3、AC-3、E-AC-3、ALAC，与桌面 MP4 白名单一致 |
| 无损 MKV | 保留原编码，由 FFmpeg Matroska 封装器检查；包含 VP9/Opus 等 MP4 白名单之外的组合 |
| 转码 MP4 | 本版 FFmpeg 可解码的视频/音频转为 H.264/AAC；iOS 使用 VideoToolbox，桌面使用 libx264，画质参数和性能不同 |

失败任务可选择另一种保存方式重试，复用已下载分片。旧任务默认 MP4；默认快速检查编码和时长，可选完整解码校验。MKV 分享到“文件”；MP4 保存相册前检查系统兼容性，下载支持不代表相册支持所有原编码。

媒体库加入 dav1d 1.5.1、内置解码器、MKV 封装、缩放/重采样及 H.264/AAC 编码。转码在前台进行，长片性能及锁屏行为待真机验证。没有宣称所有桌面外部解码库、任意损坏媒体或所有网站已支持。

包含 0.1.2 的不连续 HLS 时间轴处理与 HTTP 404 预检修复。拾光已观测到服务器分片返回 404，编码改造不能恢复缺失分片。毒舌边界两片在 Windows 封装/解码通过，整片与 iPhone 未通过验收。

上一版已成功构建的是 [0.1.1 (2)](https://github.com/gaopan513/ios-videoDownload/actions/runs/34354965766)，其 IPA 不包含本次改造。当前 Windows 本地前端构建、6 项 JS 回归和 Swift 语法检查通过；本轮新增原生编码矩阵/转码测试仍待 Xcode，尚无 0.2.0 IPA。

最低支持 iOS 17，Windows 版独立保留。

## 已接入的原型流程

输入网页或 MP4/M3U8 → 自动识别或打开网页手动播放 → 点击“完成识别” → 选择资源 → 选择保存方式并探测编码 → 下载 → 回到前台封装或转码 → 快速检查或可选完整解码校验 → 分享到“文件”或保存相册。

支持上表中的编码与输出方式；未确定编码时由你选择是否尝试。支持非 DRM 有限 HLS 的 TS/fMP4、初始化片段、字节范围、独立音轨、AES-128 和不连续时间轴。暂不接受直播、DASH、SAMPLE-AES、会话密钥和缺失分片。

下载默认同时 2 个任务，每任务最多预提交 24 个请求，每主机连接上限 6；预提交量不等于实际连接数。HLS 前台使用普通会话，退到后台后使用系统后台会话。操作系统可能延迟后台调度；认证、切换及重启恢复仍须真机验收。合并与解密在前台进行，强制退出不保证续传。MP4 使用系统后台下载任务，正常暂停保留系统任务；如果系统任务丢失，未完成的整文件请求会从头下载。

暂停/失败保留临时数据；取消删除任务临时数据；已完成的视频保存在“文件 → 我的 iPhone → StreamHarbor”。签名失效后先续签，勿通过卸载应用恢复，卸载会删除应用内视频。导出到其他文件夹或相册的文件不随应用卸载删除。

## GitHub 云构建

1. 将项目源码上传到你自己的私有仓库，保留根目录 `.github/workflows/ios-prototype.yml`、`mobile/` 和 `scripts/`。不上传 `node_modules`、`.tools`、`release`、`.test-data` 或真实站点会话。
2. 在仓库 Actions 中启用工作流，选择 **iOS prototype IPA → Run workflow**。
3. 工作流使用 macOS 15 / Xcode 26.3、Node 24.19.0、Capacitor 8.0.0、XcodeGen 2.44.1、FFmpeg 7.1.1、dav1d 1.5.1。依赖版本及媒体库源码 SHA-256 固定，未使用 Windows EXE 或 FFmpegKit 下载包。
4. 工作流先测试 HLS 核心，再构建媒体库、运行模拟器原生测试，最后归档 iPhone arm64。任何步骤失败都不应将该次运行视为可用安装包。
5. 成功后在 Artifacts 下载 `StreamHarbor-iOS-prototype`，内有 IPA、SHA256SUMS、安装说明、验证表、媒体源码和重链接材料。云构建可能消耗你的 GitHub Actions 额度。
6. 失败时下载 `ios-build-diagnostics`；这些诊断只包含构建和可控样本测试，不应加入个人站点 Cookie 或下载链接。

云构建仓库：https://github.com/gaopan513/ios-videoDownload 。在 Actions 页面查看实际构建状态；只有成功运行产生的 artifact 才包含 IPA。GitHub 工作流不需要 Apple ID、开发者证书或密码。

## Windows 侧载

使用 [Sideloadly 官方版本](https://sideloadly.io/)，按其当前说明准备 Apple 设备驱动和所需组件。在自己的 Windows 电脑连接并信任 iPhone，将 `StreamHarbor-iOS-unsigned.ipa` 拖入工具，用自己的 Apple ID 签名安装。凭据只在本机工具中输入，不提交到源码或 CI。

按系统提示信任开发者并启用开发者模式。免费账号签名通常 7 天有效，按 Sideloadly 文档设置续签；没有永久免签承诺。第一次启动先使用原型中的三个样本按钮，按 [验收表](VALIDATION.md) 记录结果。

## 本地开发

Windows 仅能构建前端、生成测试夹具和运行桌面回归；iOS 原生编译仍需要 macOS/Xcode。

```sh
npm ci --prefix mobile
npm run build --prefix mobile
npm run dev --prefix mobile
```

浏览器中显示预览提示，原生下载按钮禁用；这不是网页下载器。Windows 原有 `npm test`、`npm run build` 不改用移动端入口。

macOS 构建顺序见工作流。合成媒体夹具已随源码提供；修改夹具时可在已准备好 FFmpeg 的 Windows 项目根运行 `node scripts/ios-fixtures.mjs` 重新生成并提交校验值。

## 工程边界

`ios/Core` 是可独立 `swift test` 的播放列表与模型模块；`ios/Native` 实现网页隔离、网络、加密持久化、后台队列及媒体库接口；`ios/App` 注册 Capacitor 插件。第三方网页只可报告候选媒体，不可调用下载、文件导出或任务管理桥接。

任务数据库通过 AES-GCM 加密，密钥保存在设备 Keychain。临时视频分片由 iOS 文件保护管理，未额外加密。完成或取消任务时从任务数据库移除媒体 URL、Cookie 和解密密钥。分享与相册权限只在用户点击时请求。

第二阶段的完整设置、底部导航、完成记录清理和平台公共 Bridge 整合暂不进入；必须先通过三站真机门槛。
