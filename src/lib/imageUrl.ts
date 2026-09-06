/**
 * 图片 URL 解析（无依赖独立模块）
 * 从 lib/api 拆出：学习卡等本地组件引用它时，不会把 auth store / fetch 客户端拖进
 * 离线包（小红书 mini 构建禁网络 API）。
 */

const API_BASE = '';

/** 将服务端图片路径转为完整 URL（用于 <img src> 显示） */
export function getImageUrl(imageUrl: string): string {
  if (!imageUrl) return '';
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }
  return `${API_BASE}${imageUrl}`;
}
