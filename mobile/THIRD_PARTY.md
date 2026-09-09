# iOS 原型依赖

- Vue 3.5.42、Capacitor 8.0.0、XcodeGen 2.44.1：MIT，保留各项目许可证；Node 工具链的精确依赖见 package-lock.json。
- FFmpeg 7.1.1：https://ffmpeg.org/releases/ffmpeg-7.1.1.tar.xz
  SHA-256：`733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1`。
- iOS 配置禁用 GPL/nonfree、自动检测外部库及网络协议，仅启用本地解复用/封装与所需解码器，遵循该配置下 LGPL 2.1-or-later。完整源码、构建脚本、许可证与重链接对象随云构建 artifact 提供。不要只转发 IPA 而丢弃随附材料。
- 修改 FFmpeg 后可使用随附源代码和 `scripts/build-ios-media.sh` 重建静态库，再用本项目源码和生成的 Xcode 工程重新链接。归档中保存编译中间对象用于重新链接；重新安装仍需要使用自己的 Apple 签名。
- 合成视频和 AES 测试夹具由本项目脚本生成，不包含网站视频。桌面版本的 FFmpeg 二进制不打入 iOS 应用。

原型使用系统 UIKit、WebKit、URLSession、Security、CryptoKit、CommonCrypto、Photos。库版本及许可证变更时必须更新此文件和分发材料。
