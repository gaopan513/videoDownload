#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
VERSION=7.1.1
SHA=733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1
BASE="$ROOT/.tools/ios-media"
mkdir -p "$BASE/source"
ARCHIVE="$BASE/source/ffmpeg-$VERSION.tar.xz"
if [ ! -f "$ARCHIVE" ]; then curl --fail --location --retry 3 "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz" -o "$ARCHIVE"; fi
echo "$SHA  $ARCHIVE" | shasum -a 256 -c -
if [ ! -d "$BASE/source/ffmpeg-$VERSION" ]; then tar -xJf "$ARCHIVE" -C "$BASE/source"; fi
for SDK in iphoneos iphonesimulator; do
  TARGET=arm64-apple-ios17.0
  ARCH=aarch64
  if [ "$SDK" = iphonesimulator ]; then
    HOST_ARCH="$(uname -m)"
    TARGET="$HOST_ARCH-apple-ios17.0-simulator"
    if [ "$HOST_ARCH" = x86_64 ]; then ARCH=x86_64; fi
  fi
  PREFIX="$BASE/$SDK"
  mkdir -p "$PREFIX/build"
  (
    cd "$PREFIX/build"
    SDK_PATH="$(xcrun --sdk "$SDK" --show-sdk-path)"
    "$BASE/source/ffmpeg-$VERSION/configure" \
      --prefix="$PREFIX" --target-os=darwin --arch="$ARCH" --enable-cross-compile \
      --cc="$(xcrun --sdk "$SDK" --find clang)" \
      --extra-cflags="-target $TARGET -isysroot $SDK_PATH -fPIC" \
      --extra-ldflags="-target $TARGET -isysroot $SDK_PATH" \
      --disable-autodetect --disable-everything --disable-programs --disable-doc \
      --disable-debug --disable-asm --disable-network --disable-shared --enable-static --enable-pic \
      --disable-gpl --disable-nonfree --disable-avdevice --disable-avfilter --disable-swscale --disable-postproc \
      --enable-avformat --enable-avcodec --enable-avutil --enable-swresample \
      --enable-demuxer=hls,mov,mpegts,aac --enable-muxer=mp4 \
      --enable-parser=h264,aac,hevc,mpeg4video --enable-decoder=h264,aac,mpeg4,hevc \
      --enable-bsf=aac_adtstoasc,extract_extradata,h264_mp4toannexb --enable-protocol=file \
      > configure-output.txt
    make -j "$(sysctl -n hw.logicalcpu)" > build-output.txt 2>&1
    make install > install-output.txt
  )
done
mkdir -p "$BASE/include"
cp -R "$BASE/iphoneos/include/" "$BASE/include/"
cp "$BASE/source/ffmpeg-$VERSION/COPYING.LGPLv2.1" "$BASE/FFmpeg-LICENSE.txt"
printf 'FFmpeg %s\nSource SHA256: %s\n' "$VERSION" "$SHA" > "$BASE/build-info.txt"
xcodebuild -version >> "$BASE/build-info.txt"
