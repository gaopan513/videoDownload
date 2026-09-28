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
print('Bundle layout checks passed (not a device compatibility test).')
