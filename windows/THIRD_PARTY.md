# Third-party software

StreamHarbor application source is MIT licensed. Bundled components retain their own licenses.

- Electron / Chromium: MIT and Chromium third-party licenses. Electron's LICENSE and LICENSES.chromium.html ship with the application runtime.
- Vue: MIT; Cheerio: MIT; m3u8-parser: Apache-2.0; proxy-agent and associated agents: MIT. Exact versions are in package-lock.json.
- Ghostery adblocker Electron engine and its preload: MPL-2.0. The application downloads the AdRules list from https://github.com/tickmao/ADrules when it starts; the list is stored in the user's application data directory and is not bundled in the installer.
- FFmpeg and FFprobe Windows static binaries: 6.1.1 essentials build by gyan.dev, distributed through eugeneware/ffmpeg-static release b6.1.1. This build enables GPL features including libx264 and is GPL v3. See the included FFmpeg license and build README in resources/licenses.
- Binary origin: https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1
- Corresponding FFmpeg source commit: https://github.com/FFmpeg/FFmpeg/commit/e38092ef93
- Build configuration and upstream build details: https://www.gyan.dev/ffmpeg/builds/
- yt-dlp (YouTube channel): 2026.08.19 standalone Windows binary from https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19 (downloaded from https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe). Licensed under the Unlicense (public domain). Bundled at build/yt-dlp.exe and packaged to bin/yt-dlp.exe; it is used only for the YouTube resolve/download channel. Recorded SHA-256: 66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a.

media-lock.json records the exact SHA-256 of the FFmpeg and FFprobe executables. scripts/prepare-media.mjs checks those hashes after downloading. The initial hashes were recorded from the release assets; they are integrity pins, not a digital-signature claim.

This build is for personal use. Public redistribution requires providing the corresponding source and license materials for GPL components and their build dependencies; a source link alone is not a complete redistribution compliance package. No signing certificate or public release infrastructure is included.
