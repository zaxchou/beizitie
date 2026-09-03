import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';

// 单文件版构建：产出 beizitie.html（JS/CSS/目录全部内联）
export default defineConfig({
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
