# iOS 0.1.1 (2) 修复候选验证

2026-09-09。本报告仅针对本轮源码，不代表真机验收通过。

最新：run 34354965766 成功，修复提交 d1755b0。6 JS + 7 核心 + 6 原生测试均通过，含下述两个新增原生测试。新版 release/ios/0.1.1/StreamHarbor-iOS-unsigned.ipa 已下载，版本 0.1.1 (2)，arm64，最低 iOS17，ZIP/双层 SHA256/Web 资源核验通过。仍待用户安装后进行三站复测。

用户证据：iPhone 17、iOS 27 beta 6（用户自报），毒舌/剧踪/拾光提示找不到解析；打开网页识别后可以播放。

## 变更

- 允许 about:blank/srcdoc 子帧，并保留来自空白帧的媒体消息。
- fetch/XHR 在发起时报告已知媒体地址，不再只等响应结束。
- video 元素的无后缀 HTTP 地址交由原生有限字节探测判别 HLS/MP4；排除 blob、脚本地址和统计 query 误报。
- 识别失败报告候选数量、网页错误码和播放列表错误，不再吞掉所有错误。
- 已完成/已取消记录可删除；原生先持久化再更新内存，成品文件保留。其他任务须先取消。
- 异步恢复完成后按 ID 重找任务，避免删除其他记录后索引移位。

## 已执行

- `node --test scripts/test-ios-resolver.mjs`：6/6 通过，覆盖未完成 fetch/XHR、无后缀 video、MIME、统计地址排除、非 HTTP/空地址排除。
- `node mobile/node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p mobile/tsconfig.json`：通过。
- mobile 目录 `node node_modules/vite/bin/vite.js build`：通过。
- `python scripts/check-ios-source.py`：12 个 Swift 文件语法树、plist 和夹具哈希通过；不等同于 Swift 类型检查。

## 云端已完成及剩余验收

- 已完成：macOS 上新增 WKWebView srcdoc/无后缀媒体发现测试，以及加密记录删除、保存失败回滚、重启读取、成品保留测试。
- 已完成：iOS 0.1.1 (2) 云构建和 IPA 核验。
- 三站逐一自动/手动识别，记录新版完整错误；随后整片下载、导出、播放与锁屏验证。

## 构建入口历史（已解除）

用户已授权上传，修复源码提交 main d1755b0e4c7276ff5820896f28d6ed1515e7f1bb，12 文件远程 blob 哈希核验一致。浏览器 Actions 页面读取超时，连接器没有手动触发工作流工具，需用户在 main 新建 Run workflow。现有 release/ios IPA 为旧版，不能作为本次交付包。
