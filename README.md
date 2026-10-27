# StreamHarbor — 通用视频下载工作台

本仓库分别维护浏览器扩展、Windows 桌面端和 iOS 原型。说明于 2026-10-09 按本地源码、构建配置、发布文件和已保存验收报告核对；Windows 下载入口于 2026-10-11 更新为 1.0.1。

| 端 | 当前版本 | 使用说明 | 当前本地产物 |
| --- | --- | --- | --- |
| 浏览器扩展 | 1.0.7，Manifest V3 | [extension/README.md](extension/README.md) | [extension/dist/](extension/dist/)；[蜘蛛网图标 ZIP](artifacts/StreamHarbor-extension-1.0.7-spiderweb.zip) |
| Windows x64 | 1.0.1 | [windows/README.md](windows/README.md) | [安装包](<windows/release/1.0.1/StreamHarbor Setup 1.0.1.exe>)、[便携版](<windows/release/1.0.1/StreamHarbor 1.0.1.exe>) |
| iOS 17+ | 1.0.0（构建号 11） | [ios/README.md](ios/README.md) | [未签名 IPA](ios/release/spiderweb-20261008/StreamHarbor-iOS-unsigned.ipa)，需自行签名侧载 |

三端都可尝试网页媒体识别与 MP4/HLS 下载，但能力不同：扩展在浏览器中保存 MP4/WebM 或拼接 TS；Windows 和 iOS 可无损封装 MP4/MKV 或转码 H.264/AAC。扩展以首尾播放页链接生成批量队列；Windows 提供站点搜索、剧集选择与批量队列；iOS 保持单链接原型界面。三端使用同一蜘蛛网视频图标。

开发命令在对应目录运行：

| 端 | 安装与检查 | 开发/打包 |
| --- | --- | --- |
| 扩展 | npm ci；npm run typecheck；npm run build | 将 extension/dist 加载为已解压扩展 |
| Windows | npm ci；node scripts/prepare-media.mjs；npm test | npm run dev；npm run package |
| iOS | npm ci；npm run build；node --test scripts/test-ios-resolver.mjs | npm run dev 仅预览；原生测试与 IPA 使用 [手动工作流](.github/workflows/ios-prototype.yml) |

Windows 开发构建依赖同级的 extension/src/core/meta-media.ts；请保留仓库目录结构。扩展的部分测试也复用 windows/node_modules 中的工具，详见各端 README。

iOS 构建号 11 的 [Actions run 37761235493](https://github.com/gaopan513/videoDownload/actions/runs/37761235493) 已完成 22 项核心、16 项原生测试及 arm64 归档；本地保存了 [云构建证据](ios/release/spiderweb-20261008/cloud-build-evidence.txt)。工作流的 IPA artifact 保留 14 天，下载入口是否仍可用以 Actions 页面为准。

实际下载验收按端分别记录：[扩展](extension/VALIDATION.md)、[Windows](windows/VALIDATION.md)、[iOS](ios/VALIDATION.md)。扩展 Instagram/Facebook 样本完整落盘并通过 FFprobe；Windows Instagram 样本通过完整下载及深度解码，Facebook 现场下载未验证；iOS 目标站点整片下载、锁屏恢复与签名更新仍待真机验收。历史构建成功不等于当前所有网站可用。

项目历史见 [task_plan.md](task_plan.md)、[findings.md](findings.md) 与 [progress.md](progress.md)。各端第三方依赖及媒体许可按端内说明核对。
