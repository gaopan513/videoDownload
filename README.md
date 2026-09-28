# StreamHarbor — 通用视频下载工作台

本仓库将两端源码分开维护：

| 目录 | 内容 | 构建入口 |
| --- | --- | --- |
| [`windows/`](windows/README.md) | Windows x64 Electron 桌面端 | 在 `windows/` 运行 `npm ci`、`npm test`、`npm run package` |
| [`ios/`](ios/README.md) | iOS 17+ Capacitor/Swift 原型 | 在 `ios/` 运行 `npm ci`、`npm run build`；IPA 使用根目录的手动 GitHub Actions 工作流 |

源码版本为 1.0.0。现有 Windows 安装包与 iOS IPA 属历史版本；1.0.0 安装产物尚未构建。iOS 真机目标站点的整片下载仍待验收。项目历史和验证边界见 [`task_plan.md`](task_plan.md)、[`findings.md`](findings.md) 与 [`progress.md`](progress.md)。
