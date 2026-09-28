# StreamHarbor

通用视频下载工作台。1.0.0 源码包含 Windows 桌面端与 iPhone 原型；已有安装包和 IPA 是历史版本，需重新构建才能得到 1.0.0 安装产物。

## iPhone 原型（独立构建）

iOS 17+ 原型与 GitHub Actions 云构建流程已跑通。最新已验证可安装的 IPA 仍为 0.2.2(7)（`release/ios/0.2.2/StreamHarbor-iOS-unsigned.ipa`）；1.0.0 源码包含随后完成的解析性能优化和候选过滤，尚未完成云构建、三站真机验收与下载提速复测。版本记录见 [mobile/README.md](mobile/README.md)。Windows 版继续使用下方流程。

Windows x64 中文网页视频下载工具。粘贴网页、MP4 或 M3U8 地址，解析资源，选择清晰度与目录后下载。仅支持完整视频，不录制直播。

## 使用

已有 Windows 安装包为 0.1.3：在 `release` 目录运行 `StreamHarbor Setup 0.1.3.exe` 安装，或运行 `StreamHarbor 0.1.3.exe` 便携版。要获得 1.0.0 安装包，请按下方开发与构建步骤重新打包。也可直接运行 `release/win-unpacked/StreamHarbor.exe`，该目录需整体保留。

1. 每行粘贴一个网址，点击“解析链接”；最多一次 30 个。
2. 选择资源、清晰度和音轨。单一候选默认选中；选择保存目录，点击“下载所选”。
3. 在队列中暂停、继续或取消。失败可重试；“重新下载”会重新解析并清除旧分片，需要确认。
4. 不兼容 MP4 时选择转码 MP4 或无损 MKV。完成后点击“打开文件位置”。

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

`npm run smoke` 在独立测试数据目录启动 Electron，执行真实 UI、后台解析和下载校验，生成 `artifacts/desktop.png` 和测试报告。先运行核心测试生成测试视频。

## 模块

- `src/core`：网络与代理、播放列表、解密、恢复清单、分片调度和媒体处理。
- `src/main`：Electron 窗口、会话、后台发现、受限 IPC、安全存储和下载进程。
- `src/ui`：Vue 中文界面。
- `tests`：本地 HTTP 与 FFmpeg 生成的可控资源，不依赖第三方视频。
- `mobile`：iPhone 原型（Capacitor 前端与 `ios/Core`、`ios/Native`、`ios/App` 原生模块），见 `mobile/README.md`。

开发计划在 `task_plan.md`；调查结果在 `findings.md`；开发记录在 `progress.md`。依赖与媒体许可证见 `THIRD_PARTY.md`。当前交付为未签名个人使用构建。


在下载队列或已完成页面点击“清除完成记录”，可移除全部完成记录。视频文件和未完成任务保留，清除结果在重启后仍生效。
