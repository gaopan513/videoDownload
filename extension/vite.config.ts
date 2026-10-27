import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import fs from 'fs';
import { buildSync } from 'esbuild';

// 简单高效的 Manifest V3 复制与静态打包插件
function copyManifestPlugin() {
  return {
    name: 'copy-manifest-and-assets',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');
      if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
      }
      // Manifest content scripts are classic scripts; Rollup's shared ESM imports are invalid here.
      buildSync({ entryPoints: [resolve(__dirname, 'src/content/index.ts')], outfile: resolve(distDir, 'content/index.js'), bundle: true, format: 'iife', minify: true, target: 'chrome120' });
      for (const name of ['meta-main', 'meta-bridge']) buildSync({ entryPoints: [resolve(__dirname, `src/content/${name}.ts`)], outfile: resolve(distDir, `content/${name}.js`), bundle: true, format: 'iife', minify: true, target: 'chrome120' });
      // 读取并写入调整后的 manifest.json
      const manifestPath = resolve(__dirname, 'src/manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          // 将开发路径替换为 dist 构建路径
          manifest.background = {
            service_worker: 'background/index.js',
            type: 'module'
          };
          manifest.content_scripts = manifest.content_scripts.map((script: { js: string[] }) => ({ ...script, js: script.js.map(file => file.replace('src/content/', 'content/').replace('.ts', '.js')) }));
          manifest.action.default_popup = 'src/popup/index.html';
          fs.writeFileSync(resolve(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        } catch (err) {
          console.error('Failed to parse or write manifest.json:', err);
        }
      }

      // 复制 icons
      const iconsDir = resolve(__dirname, 'src/icons');
      const distIcons = resolve(distDir, 'icons');
      if (fs.existsSync(iconsDir)) {
        if (!fs.existsSync(distIcons)) fs.mkdirSync(distIcons, { recursive: true });
        fs.cpSync(iconsDir, distIcons, { recursive: true });
      }
    }
  };
}

export default defineConfig({
  plugins: [vue(), copyManifestPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        offscreen: resolve(__dirname, 'src/offscreen/index.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts')
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'background/index.js';
          if (chunkInfo.name === 'content') return 'content/index.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.html')) {
            return 'popup/[name].[ext]';
          }
          return 'assets/[name]-[hash].[ext]';
        }
      }
    }
  }
});
