# StreamHarbor iPhone 原型

这是第一阶段源码，最低支持 iOS 17。Windows 版独立保留。

**当前未完成 macOS 编译和三站真机验收，不是已验证可安装的正式版。** 云端工作流成功后才会产生 `StreamHarbor-iOS-unsigned.ipa`。待签名 IPA 不能直接在 iPhone 上点开安装。

## 已接入的原型流程

输入网页或 MP4/M3U8 → 自动识别或打开网页手动播放 → 点击“完成识别” → 选择资源 → 探测编码 → 下载 → 回到前台合并和完整解码校验 → 分享到“文件”或保存相册。

仅接受 H.264 视频和 AAC 音轨；未确定编码时由你选择是否尝试。支持非 DRM 有限 HLS 的 TS/fMP4、初始化片段、字节范围、独立音轨和 AES-128。暂不接受直播、DASH、SAMPLE-AES、会话密钥、缺失分片和不连续时间轴。原型不支持转码。

下载默认同时 2 个任务，每任务最多提交 4 个后台请求。操作系统可能延迟调度；后台请求、认证及重启恢复还必须按验收表实测，不能由代码或模拟器测试推出已可靠运行。合并与解密在前台进行，强制退出不保证续传。MP4 使用系统下载任务，正常暂停保留系统任务；如果系统任务丢失，未完成的整文件请求会从头下载。

暂停/失败保留临时数据；取消删除任务临时数据；已完成的视频保存在“文件 → 我的 iPhone → StreamHarbor”。签名失效后先续签，勿通过卸载应用恢复，卸载会删除应用内视频。导出到其他文件夹或相册的文件不随应用卸载删除。

## GitHub 云构建

1. 将项目源码上传到你自己的私有仓库，保留根目录 `.github/workflows/ios-prototype.yml`、`mobile/` 和 `scripts/`。不上传 `node_modules`、`.tools`、`release`、`.test-data` 或真实站点会话。
2. 在仓库 Actions 中启用工作流，选择 **iOS prototype IPA → Run workflow**。
3. 工作流使用 macOS 15 / Xcode 26.3、Node 24.19.0、Capacitor 8.0.0、XcodeGen 2.44.1、FFmpeg 7.1.1。依赖版本和 FFmpeg 源码 SHA-256 固定，未使用 Windows EXE 或 FFmpegKit 下载包。
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
