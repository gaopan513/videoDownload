import pathlib, zipfile, hashlib, json
root = pathlib.Path(__file__).resolve().parent.parent
release = root / 'release'
release.mkdir(exist_ok=True)
version = json.loads((root / 'package.json').read_text(encoding='utf8'))['version']
archive = release / f'StreamHarbor-source-{version}.zip'
folders = ['src', 'scripts', 'tests']
names = ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html', 'media-lock.json', '.gitignore', 'README.md', 'VALIDATION.md', 'THIRD_PARTY.md', 'LICENSE', 'task_plan.md', 'findings.md', 'progress.md']
files = [root / name for name in names]
for folder in folders:
    files += [p for p in (root / folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts]
files += [p for p in (root / 'artifacts').glob('*') if p.suffix in ('.json', '.txt', '.png')]
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
    for file in files:
        z.write(file, file.relative_to(root).as_posix())
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
print('Source archive verified:', archive.name, archive.stat().st_size)
