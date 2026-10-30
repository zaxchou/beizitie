import { defineConfig, mergeConfig } from 'vite';
import miniConfig from './vite.config.mini';

// 独立设计预览入口，复用包内数据与图片；不替换现有小工具或打包产物。
export default mergeConfig(miniConfig, defineConfig({
  server: { host: '127.0.0.1', port: 8913, strictPort: true },
}));
