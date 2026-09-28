"""Use the same system proxy as Python's verified downloads for build tools."""
import os, subprocess, urllib.request
env = os.environ.copy()
for protocol, proxy in urllib.request.getproxies().items():
    if protocol in ('http', 'https'):
        env[protocol.upper() + '_PROXY'] = proxy
env['ELECTRON_BUILDER_CACHE'] = os.path.abspath('.tools/builder-cache')
env['electron_config_cache'] = os.path.abspath('.tools/electron-cache')
raise SystemExit(subprocess.call(['node', 'scripts/package.mjs'], env=env))
