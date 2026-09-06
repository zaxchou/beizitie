import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';
import { readFileSync } from 'fs';

const json = JSON.parse(readFileSync('./package.json', 'utf-8'));

/**
 * 小红书小工具构建（离线单 html + 包内字图）
 * - 纯本地：目录与单字清单由 mini/data 内联，字图为 mini/public 相对路径（构建期原样拷贝）
 * - 兼容基线 Android 8.1 / Chrome 61：语法转译 es2017
 * - 产物 dist-mini/mini.html → 重命名 index.html 放 zip 根（见 build-mini.sh）
 * - 数据来源：node mini/build-data.mjs（先跑）
 */
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@catalog/source': path.resolve(__dirname, 'src/single/catalog-source.mini.ts'),
      '@data-page': path.resolve(__dirname, 'src/single/pages/DataPageMini.tsx'),
      '@settings/backup-card': path.resolve(__dirname, 'src/single/SettingsBackupCard.mini.tsx'),
      '@pages/market': path.resolve(__dirname, 'src/single/pages/MarketPage.mini.tsx'),
      '@pages/jizi': path.resolve(__dirname, 'src/single/pages/JiziPageMini.tsx'),
    },
  },
  define: {
    __MINI__: true,
    __APP_VERSION__: JSON.stringify(json.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  publicDir: 'mini/public',
  build: {
    target: ['es2017', 'chrome61'],
    modulePreload: { polyfill: false },  // 单 html 无动态依赖，去掉 vite 预加载垫片（内含 fetch）
    outDir: 'dist-mini',
    rollupOptions: {
      input: path.resolve(__dirname, 'mini.html'),
    },
  },
});
