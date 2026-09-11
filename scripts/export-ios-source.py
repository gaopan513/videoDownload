"""Export only the iOS source/build material, never desktop state or user credentials."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib

root = Path(__file__).resolve().parents[1]
destination = root / 'release' / 'ios-source'
destination.mkdir(parents=True, exist_ok=True)
archive = destination / 'StreamHarbor-iOS-prototype-source.zip'
files = []
for file in (root / 'mobile').rglob('*'):
    if not file.is_file():
        continue
    if any(part in ('node_modules','dist','public','.build','.swiftpm','__pycache__') or part.endswith('.xcodeproj') for part in file.relative_to(root / 'mobile').parts):
        continue
    files.append(file)
files.extend(root / name for name in [
    '.github/workflows/ios-prototype.yml','.gitattributes','.gitignore','LICENSE',
    'scripts/build-ios-media.sh','scripts/package-ios.sh','scripts/check-ios-bundle.py',
    'scripts/check-ios-source.py','scripts/check-mp4-chunks.mjs','scripts/ios-fixtures.mjs','scripts/export-ios-source.py','scripts/test-ios-resolver.mjs'
])
with ZipFile(archive,'w',compression=ZIP_DEFLATED) as bundle:
    for file in sorted(files):
        bundle.write(file, file.relative_to(root).as_posix())
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(destination / 'SHA256SUMS.txt').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
print(f'{archive}\n{len(files)} source/fixture files; {archive.stat().st_size} bytes. This is source code, NOT an IPA.')
