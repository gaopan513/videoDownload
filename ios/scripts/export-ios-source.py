"""Export iOS source/build material without desktop state or credentials."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib

root = Path(__file__).resolve().parents[1]
repository = root.parent
destination = root / 'release' / 'ios-source'
destination.mkdir(parents=True, exist_ok=True)
archive = destination / 'StreamHarbor-iOS-prototype-source.zip'
excluded = {'node_modules', 'dist', 'public', '.build', '.swiftpm', '__pycache__', '.tools', 'release'}
files = [p for p in root.rglob('*') if p.is_file()
         and not any(part in excluded or part.endswith('.xcodeproj') for part in p.relative_to(root).parts)]
files.extend(repository / name for name in (
    '.github/workflows/ios-prototype.yml', '.gitattributes', '.gitignore', 'LICENSE'))
with ZipFile(archive, 'w', compression=ZIP_DEFLATED) as bundle:
    for file in sorted(files):
        bundle.write(file, file.relative_to(repository).as_posix())
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(destination / 'SHA256SUMS.txt').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
print(f'{archive}\n{len(files)} source/fixture files; {archive.stat().st_size} bytes. This is source code, NOT an IPA.')
