#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
BUILD="$ROOT/.tools/ios-build"
mkdir -p "$BUILD" "$ROOT/mobile/ios/public" "$ROOT/release/ios"
cp -R "$ROOT/mobile/dist/" "$ROOT/mobile/ios/public/"
"$ROOT/.tools/XcodeGen/.build/release/xcodegen" generate --spec "$ROOT/mobile/ios/project.yml"
PROJECT="$ROOT/mobile/ios/StreamHarbor.xcodeproj"
xcodebuild -resolvePackageDependencies -project "$PROJECT" -scheme StreamHarbor -clonedSourcePackagesDirPath "$BUILD/packages" > "$BUILD/packages.log" 2>&1
# Simulator code is tested, but only an iphoneos arm64 archive goes into the IPA.
DEVICE="$(xcrun simctl list devices available -j | python3 -c 'import sys,json; d=json.load(sys.stdin); print(next(x["udid"] for k,v in d["devices"].items() if "iOS" in k for x in v if x["name"].startswith("iPhone")))')"
xcodebuild test -project "$PROJECT" -scheme StreamHarbor \
  -destination "platform=iOS Simulator,id=$DEVICE" -derivedDataPath "$BUILD/simulator" \
  -clonedSourcePackagesDirPath "$BUILD/packages" -resultBundlePath "$BUILD/native-tests.xcresult" \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- > "$BUILD/simulator.log" 2>&1
xcodebuild archive -project "$PROJECT" -scheme StreamHarbor -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$BUILD/StreamHarbor.xcarchive" \
  -derivedDataPath "$BUILD/device" -clonedSourcePackagesDirPath "$BUILD/packages" \
  CODE_SIGNING_ALLOWED=NO ARCHS=arm64 > "$BUILD/archive.log" 2>&1
mkdir -p "$BUILD/payload/Payload"
ditto "$BUILD/StreamHarbor.xcarchive/Products/Applications/StreamHarbor.app" "$BUILD/payload/Payload/StreamHarbor.app"
xcrun lipo -verify_arch arm64 "$BUILD/payload/Payload/StreamHarbor.app/StreamHarbor"
python3 scripts/check-ios-bundle.py "$BUILD/payload/Payload/StreamHarbor.app"
(cd "$BUILD/payload" && ditto -c -k --sequesterRsrc --keepParent Payload "$ROOT/release/ios/StreamHarbor-iOS-unsigned.ipa")
(cd "$ROOT/release/ios" && shasum -a 256 StreamHarbor-iOS-unsigned.ipa > SHA256SUMS.txt)
cp "$ROOT/mobile/README.md" "$ROOT/release/ios/INSTALL.md"
cp "$ROOT/mobile/VALIDATION.md" "$ROOT/release/ios/VALIDATION.md"
cp "$ROOT/.tools/ios-media/build-info.txt" "$ROOT/release/ios/build-info.txt"
# Accompany static LGPL libraries with source, configuration and relinkable app objects.
mkdir -p "$BUILD/relink"
cp "$ROOT/.tools/ios-media/source/ffmpeg-7.1.1.tar.xz" "$BUILD/relink/"
cp "$ROOT/scripts/build-ios-media.sh" "$ROOT/mobile/THIRD_PARTY.md" "$ROOT/.tools/ios-media/FFmpeg-LICENSE.txt" "$BUILD/relink/"
ditto "$BUILD/device/Build/Intermediates.noindex/ArchiveIntermediates/StreamHarbor" "$BUILD/relink/ArchiveIntermediates"
ditto -c -k --keepParent "$BUILD/relink" "$ROOT/release/ios/StreamHarbor-relink-materials.zip"
