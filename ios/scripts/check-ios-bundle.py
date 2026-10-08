"""Fail a cloud build with missing WebView assets or desktop files in its IPA."""
import pathlib, plistlib, sys
app = pathlib.Path(sys.argv[1])
with (app / 'Info.plist').open('rb') as handle:
    info = plistlib.load(handle)
assert info['CFBundleIdentifier'] == 'local.streamharbor.ios'
assert float(info['MinimumOSVersion']) >= 17
assert (app / 'public' / 'index.html').is_file(), 'Web assets missing'
assert (app / 'capacitor.config.json').is_file(), 'Capacitor config missing'
assert (app / 'Frameworks' / 'Capacitor.framework').is_dir(), 'Capacitor framework missing'
assert not any(p.suffix.lower() in ('.exe', '.cjs') for p in app.rglob('*')), 'Desktop runtime accidentally bundled'
assert (app / 'StreamHarbor').stat().st_size > 100_000
primary_icon = info.get('CFBundleIcons', {}).get('CFBundlePrimaryIcon', {})
assert primary_icon.get('CFBundleIconName') == 'AppIcon', 'AppIcon is not configured in the compiled bundle'
assert (app / 'Assets.car').is_file(), 'Compiled asset catalog missing'
for name in primary_icon.get('CFBundleIconFiles', []):
    assert any(app.glob(name + '*.png')), f'Compiled app icon missing: {name}'
assert primary_icon.get('CFBundleIconFiles'), 'No compiled app icon files'
print('Bundle layout checks passed (not a device compatibility test).')
