#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
VERSION=7.1.1
SHA=733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1
BASE="$ROOT/.tools/ios-media"
DAV1D_VERSION=1.5.1
DAV1D_SHA=401813f1f89fa8fd4295805aa5284d9aed9bc7fc1fdbe554af4292f64cbabe21
mkdir -p "$BASE/source"
DAV1D_ARCHIVE="$BASE/source/dav1d-$DAV1D_VERSION.tar.xz"
if [ ! -f "$DAV1D_ARCHIVE" ]; then curl --fail --location --retry 3 "https://download.videolan.org/pub/videolan/dav1d/$DAV1D_VERSION/dav1d-$DAV1D_VERSION.tar.xz" -o "$DAV1D_ARCHIVE"; fi
echo "$DAV1D_SHA  $DAV1D_ARCHIVE" | shasum -a 256 -c -
if [ ! -d "$BASE/source/dav1d-$DAV1D_VERSION" ]; then tar -xJf "$DAV1D_ARCHIVE" -C "$BASE/source"; fi
python3 -m venv "$BASE/build-tools"
"$BASE/build-tools/bin/pip" install --disable-pip-version-check meson==1.7.0 ninja==1.11.1.3
export PATH="$BASE/build-tools/bin:$PATH"
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
  SDK_PATH="$(xcrun --sdk "$SDK" --show-sdk-path)"
  cat > "$PREFIX/dav1d-cross.ini" <<EOF
[binaries]
c = '$(xcrun --sdk "$SDK" --find clang)'
ar = '$(xcrun --sdk "$SDK" --find ar)'
strip = '$(xcrun --sdk "$SDK" --find strip)'
[host_machine]
system = 'darwin'
cpu_family = '$ARCH'
cpu = '$ARCH'
endian = 'little'
[properties]
needs_exe_wrapper = true
[built-in options]
c_args = ['-target', '$TARGET', '-isysroot', '$SDK_PATH', '-fPIC']
c_link_args = ['-target', '$TARGET', '-isysroot', '$SDK_PATH']
EOF
  MESON_SETUP=()
  if [ -f "$PREFIX/dav1d-build/meson-private/coredata.dat" ]; then MESON_SETUP+=(--reconfigure); fi
  meson setup "${MESON_SETUP[@]}" "$PREFIX/dav1d-build" "$BASE/source/dav1d-$DAV1D_VERSION" \
    --cross-file "$PREFIX/dav1d-cross.ini" --prefix "$PREFIX" --libdir lib \
    --buildtype release -Ddefault_library=static -Denable_tools=false -Denable_tests=false -Denable_asm=false
  meson compile -C "$PREFIX/dav1d-build"
  meson install -C "$PREFIX/dav1d-build"
  (
    cd "$PREFIX/build"
    SDK_PATH="$(xcrun --sdk "$SDK" --show-sdk-path)"
    PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig" "$BASE/source/ffmpeg-$VERSION/configure" \
      --prefix="$PREFIX" --target-os=darwin --arch="$ARCH" --enable-cross-compile \
      --cc="$(xcrun --sdk "$SDK" --find clang)" \
      --extra-cflags="-target $TARGET -isysroot $SDK_PATH -fPIC" \
      --extra-ldflags="-target $TARGET -isysroot $SDK_PATH" \
      --disable-autodetect --disable-everything --disable-programs --disable-doc \
      --disable-debug --disable-asm --disable-network --disable-shared --enable-static --enable-pic \
      --disable-gpl --disable-nonfree --disable-avdevice --disable-postproc \
      --enable-avformat --enable-avcodec --enable-avutil --enable-swresample --enable-avfilter --enable-swscale \
      --enable-demuxers --enable-parsers --enable-decoders --enable-muxer=mp4,matroska \
      --enable-libdav1d --pkg-config-flags=--static --enable-videotoolbox --enable-encoder=h264_videotoolbox,aac \
      --enable-filter=buffer,abuffer,buffersink,abuffersink,scale,format,aformat,aresample \
      --enable-bsf=aac_adtstoasc,extract_extradata,h264_mp4toannexb --enable-protocol=file \
      > configure-output.txt
    make -j "$(sysctl -n hw.logicalcpu)" > build-output.txt 2>&1
    make install > install-output.txt
  )
done
mkdir -p "$BASE/include"
cp -R "$BASE/iphoneos/include/" "$BASE/include/"
cp "$BASE/source/ffmpeg-$VERSION/COPYING.LGPLv2.1" "$BASE/FFmpeg-LICENSE.txt"
cp "$BASE/source/dav1d-$DAV1D_VERSION/COPYING" "$BASE/dav1d-LICENSE.txt"
printf 'FFmpeg %s\nSource SHA256: %s\n' "$VERSION" "$SHA" > "$BASE/build-info.txt"
printf 'dav1d %s\nSource SHA256: %s\nH.264 encoder: Apple VideoToolbox; audio encoder: FFmpeg AAC\n' "$DAV1D_VERSION" "$DAV1D_SHA" >> "$BASE/build-info.txt"
xcodebuild -version >> "$BASE/build-info.txt"
