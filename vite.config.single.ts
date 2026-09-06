import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';
import { readFileSync } from 'fs';

const json = JSON.parse(readFileSync('./package.json', 'utf-8'));

// @catalog/source / @data-page：单文件版指向全量目录实现（mini 构建经 alias 换离线实现）


// 单文件版构建：产出 beizitie.html（JS/CSS/目录全部内联）
export default defineConfig({
  define: {
    // 版本号唯一来源是 package.json；应用内（设置页「关于」）与 CHANGELOG 均以此为准
    __MINI__: false,
    __APP_VERSION__: JSON.stringify(json.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@catalog/source': path.resolve(__dirname, 'src/single/catalog-source.ts'),
      '@data-page': path.resolve(__dirname, 'src/single/pages/DataPage.tsx'),
      '@settings/backup-card': path.resolve(__dirname, 'src/single/SettingsBackupCard.tsx'),
      '@pages/market': path.resolve(__dirname, 'src/single/pages/MarketPage.tsx'),
      '@pages/jizi': path.resolve(__dirname, 'src/single/pages/JiziPage.tsx'),
    },
  },
  build: {
    target: 'es2020',
    outDir: 'dist-single',
    rollupOptions: {
      input: path.resolve(__dirname, 'single.html'),
      output: {
        manualChunks: undefined,
      },
    },
  },
});
