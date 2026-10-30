import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';
const json = JSON.parse(readFileSync('./package.json', 'utf-8'));


/**
 * 构建门禁：`__MINI__` 这类 define 常量如果在产物里残留，会在浏览器里抛
 * ReferenceError 并让整条路由白屏（2026-10-30 学习页事故）。这里直接让构建失败。
 */
function noUndefinedDefines() {
  const guarded = ['__MINI__', '__APP_VERSION__', '__BUILD_DATE__'];
  return {
    name: 'no-undefined-defines',
    apply: 'build' as const,
    generateBundle(_options: unknown, bundle: Record<string, { type: string; code?: string }>) {
      for (const [file, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.code) continue;
        for (const name of guarded) {
          if (chunk.code.includes(name)) {
            this.error(`构建产物 ${file} 里残留未替换的 ${name}（vite define 缺失）。`);
          }
        }
      }
    },
  };
}

export default defineConfig({
  define: {
    // 在线版不是离线小工具：这个开关必须显式定义，否则 FlashCard 里的
    // `__MINI__ ? … : …` 会在运行期抛 ReferenceError，学习页整页白屏。
    __MINI__: 'false',
    // 版本号唯一来源是 package.json；应用内（设置页「关于」）与 CHANGELOG 均以此为准
    __APP_VERSION__: JSON.stringify(json.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [react(), noUndefinedDefines()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
    },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom', 'react-router-dom'],
          'mui-core': ['@mui/material', '@emotion/react', '@emotion/styled'],
          'mui-icons': ['@mui/icons-material'],
        },
      },
    },
  },
});
