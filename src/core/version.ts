/**
 * 应用版本（构建时由 vite define 注入，来源 package.json.version）。
 * 发布流程见 scripts/release-version.sh 与 docs/双版本维护SOP.md 的「版本规范」。
 */
declare const __APP_VERSION__: string | undefined;
declare const __BUILD_DATE__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const BUILD_DATE: string = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : '';
