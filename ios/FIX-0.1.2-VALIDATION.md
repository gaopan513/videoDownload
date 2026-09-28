# iOS 0.1.2 (3) 验证记录

提交：a620cdc6c39e4c3ddd03a6a7b72dc1ae68f24ce5。2026-09-10。

毒舌：实时列表 HTTP200，2812分片，带 DISCONTINUITY/ENDLIST，无SESSION-KEY/GAP。新增边界持久化和MAP重复输出；下载后按边界拆分本地HLS，再用ffconcat与声明时长拼接时间戳。保持固定FFmpeg版本7.1.1，增加concat demuxer。

拾光：新网页同session中播放列表200，但static.yximgs.com前两个媒体分片404。此次修复客户端预检吞掉HTTP错误并将失败当编码未知的问题，显示资源阶段、分片编号与服务器；不宣称修复源服务器，不跳过分片。

本地已通过：
- 12 Swift文件语法树/plist/夹具哈希。
- 合成2+2秒时间戳重置TS，经concat读取48包时间戳单调、封装完整解码通过。
- 毒舌第一个边界前后两片，封装为6.017959秒H.264/AAC并完整解码通过。只验证样本，不是整片。
- 11上传文件Git blob哈希一致。

待云端：新增4核心与2原生回归（预计总计6 JS、11核心、8原生），包括旧记录兼容、MAP/密钥IV/边界传递、原生连续4秒输出及预检404阻止入队；尚未执行，不标记通过。

待真机：毒舌整片、拾光切换或恢复线路后的下载、导出播放/锁屏；0.1.1旧IPA不含本轮修改。

规范参考：[RFC8216](https://www.rfc-editor.org/rfc/rfc8216)，4.3.2.3 与4.3.3.3。证据位于 artifacts/ios-hls-probe.json、time-session-segments.json、ios-discontinuity-validation.json、dushe-boundary-validation.json。原始签名媒体URL仅保存在本地.tools，未上传。
