import pathlib, zipfile, hashlib, json, argparse
root = pathlib.Path(__file__).resolve().parent.parent
release = root / 'release'
release.mkdir(exist_ok=True)
version = json.loads((root / 'package.json').read_text(encoding='utf8'))['version']
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=pathlib.Path)
args = parser.parse_args()
archive = args.output or release / f'StreamHarbor-source-{version}.zip'
archive.parent.mkdir(parents=True, exist_ok=True)
folders = ['src', 'scripts', 'tests', 'build']
names = ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html', 'media-lock.json', 'README.md', 'VALIDATION.md', 'THIRD_PARTY.md']
files = [root / name for name in names]
for folder in folders:
    files += [p for p in (root / folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts]
files += [p for p in (root / 'artifacts').glob('*') if p.suffix in ('.json', '.txt', '.png')]
shared = [root.parent / name for name in ('.gitignore', 'LICENSE', 'task_plan.md', 'findings.md', 'progress.md')]
icon_shared = [root.parent / name for name in ('scripts/generate-app-icons.ps1', 'extension/branding/spiderweb-master.png')]
meta_shared = [root.parent / 'extension' / 'src' / name for name in ('core/meta-media.ts', 'core/utils.ts', 'shared/types.ts')]
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
    for file in files:
        # Preserve sibling source paths used by the shared Meta parser.
        z.write(file, 'windows/' + file.relative_to(root).as_posix())
    for file in shared:
        z.write(file, file.name)
    for file in meta_shared:
        z.write(file, file.relative_to(root.parent).as_posix())
    for file in icon_shared:
        z.write(file, file.relative_to(root.parent).as_posix())
checksums = []
for file in sorted(release.iterdir()):
    if file.suffix in ('.exe', '.zip'):
        h = hashlib.sha256()
        with file.open('rb') as f:
            for b in iter(lambda: f.read(1024 * 1024), b''):
                h.update(b)
        checksums.append(f'{h.hexdigest()}  {file.name}')
(release / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n')
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert 'windows/package.json' in z.namelist()
    assert all(file.relative_to(root.parent).as_posix() in z.namelist() for file in meta_shared)
    assert all(file.relative_to(root.parent).as_posix() in z.namelist() for file in icon_shared)
print('Source archive verified:', archive.name, archive.stat().st_size)
