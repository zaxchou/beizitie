import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

const json = JSON.parse(readFileSync('./package.json', 'utf-8'));

/**
 * 小红书小工具构建（离线 H5 + 包内字图）
 * - 容器 CSP 硬约束（zip-artifact-spec.md §3/§5）：脚本必须「外置经典脚本」——
 *   内联 <script> 与 type="module" 都被容器 CSP 禁止（症状：JS 完全不执行、页面空白）。
 *   因此不用 vite-plugin-singlefile（它产出内联 module 脚本，正是七连拒根因），
 *   改为 IIFE 经典脚本外置：index.html + ./app.js + ./index.css + img/atlas/*.webp
 * - base './'：容器以离线 zip 根为 /，资源一律相对路径
 * - 兼容基线 Android 8.1 / Chrome 61：语法转译 es2017
 * - 字体名收敛在 build-mini.sh 构建后对最终产物做
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      // 字在帖中不进小工具包（其文案含「上海图书馆 IIIF」，且包内帖无此功能）
      // 注意必须排在 '@' 之前：vite alias 按声明顺序匹配，'@' 会先吃掉 '@/...' 开头的导入
      '@/components/study/OriginalPageView': path.resolve(__dirname, 'src/components/study/OriginalPageView.mini.tsx'),
      '@': path.resolve(__dirname, 'src'),
      // 帖页壳（古籍编排）接管小工具；旧 MUI 壳 App.tsx 保留给单文件版过渡
      '@app/root': path.resolve(__dirname, 'src/single/tieye/TieyeApp.tsx'),
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
    modulePreload: { polyfill: false },
    cssCodeSplit: false,
    outDir: 'dist-mini',
    rollupOptions: {
      input: path.resolve(__dirname, 'mini.html'),
      output: {
        // 经典脚本（非 module）：容器 CSP 禁止内联与 module，见文件头注释
        format: 'iife',
        entryFileNames: 'app.js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
