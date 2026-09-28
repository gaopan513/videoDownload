#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
BUILD="$ROOT/.tools/ios-build"
mkdir -p "$BUILD" "$ROOT/ios/public" "$ROOT/release"
cp -R "$ROOT/dist/" "$ROOT/ios/public/"
"$ROOT/.tools/XcodeGen/.build/release/xcodegen" generate --spec "$ROOT/ios/project.yml"
PROJECT="$ROOT/ios/StreamHarbor.xcodeproj"
xcodebuild -resolvePackageDependencies -project "$PROJECT" -scheme StreamHarbor -clonedSourcePackagesDirPath "$BUILD/packages" 2>&1 | tee "$BUILD/packages.log"
# Simulator code is tested, but only an iphoneos arm64 archive goes into the IPA.
DEVICE="$(xcrun simctl list devices available -j | python3 -c 'import sys,json; d=json.load(sys.stdin); print(next(x["udid"] for k,v in d["devices"].items() if "iOS" in k for x in v if x["name"].startswith("iPhone")))')"
xcodebuild test -project "$PROJECT" -scheme StreamHarbor \
  -destination "platform=iOS Simulator,id=$DEVICE" -derivedDataPath "$BUILD/simulator" \
  -clonedSourcePackagesDirPath "$BUILD/packages" -resultBundlePath "$BUILD/native-tests.xcresult" \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- 2>&1 | tee "$BUILD/simulator.log"
xcodebuild archive -project "$PROJECT" -scheme StreamHarbor -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$BUILD/StreamHarbor.xcarchive" \
  -derivedDataPath "$BUILD/device" -clonedSourcePackagesDirPath "$BUILD/packages" \
  CODE_SIGNING_ALLOWED=NO ARCHS=arm64 2>&1 | tee "$BUILD/archive.log"
mkdir -p "$BUILD/payload/Payload"
ditto "$BUILD/StreamHarbor.xcarchive/Products/Applications/StreamHarbor.app" "$BUILD/payload/Payload/StreamHarbor.app"
xcrun lipo "$BUILD/payload/Payload/StreamHarbor.app/StreamHarbor" -verify_arch arm64
python3 "$ROOT/scripts/check-ios-bundle.py" "$BUILD/payload/Payload/StreamHarbor.app"
(cd "$BUILD/payload" && ditto -c -k --sequesterRsrc --keepParent Payload "$ROOT/release/StreamHarbor-iOS-unsigned.ipa")
(cd "$ROOT/release" && shasum -a 256 StreamHarbor-iOS-unsigned.ipa > SHA256SUMS.txt)
cp "$ROOT/README.md" "$ROOT/release/INSTALL.md"
cp "$ROOT/VALIDATION.md" "$ROOT/release/VALIDATION.md"
cp "$ROOT/.tools/ios-media/build-info.txt" "$ROOT/release/build-info.txt"
# Accompany static LGPL libraries with source, configuration and relinkable app objects.
mkdir -p "$BUILD/relink"
cp "$ROOT/.tools/ios-media/source/ffmpeg-7.1.1.tar.xz" "$BUILD/relink/"
cp "$ROOT/.tools/ios-media/source/dav1d-1.5.1.tar.xz" "$ROOT/.tools/ios-media/dav1d-LICENSE.txt" "$BUILD/relink/"
cp "$ROOT/scripts/build-ios-media.sh" "$ROOT/THIRD_PARTY.md" "$ROOT/.tools/ios-media/FFmpeg-LICENSE.txt" "$BUILD/relink/"
ditto "$BUILD/device/Build/Intermediates.noindex/ArchiveIntermediates/StreamHarbor" "$BUILD/relink/ArchiveIntermediates"
ditto -c -k --keepParent "$BUILD/relink" "$ROOT/release/StreamHarbor-relink-materials.zip"
