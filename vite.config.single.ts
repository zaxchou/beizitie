import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';
import { readFileSync } from 'fs';
const json = JSON.parse(readFileSync('./package.json', 'utf-8'));


// 单文件版构建：产出 beizitie.html（JS/CSS/目录全部内联）
export default defineConfig({
  define: {
    // 版本号唯一来源是 package.json；应用内（设置页「关于」）与 CHANGELOG 均以此为准
    __APP_VERSION__: JSON.stringify(json.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
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
