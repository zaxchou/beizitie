/**
 * 小红书 mini 构建的兼容补丁（仅 __MINI__ 时由 main.tsx 引入）
 */

/** Flex gap 在 Chrome 61（基线下限）不可用：行为检测失败时，把 flex 容器的 gap 改写为子项 margin */
function installFlexGapPolyfill(): void {
  try {
    const test = document.createElement('div');
    test.style.cssText = 'position:absolute;visibility:hidden;display:flex;gap:8px';
    test.innerHTML = '<span>a</span><span>b</span>';
    document.body.appendChild(test);
    const l = (test.children[0] as HTMLElement).getBoundingClientRect();
    const r = (test.children[1] as HTMLElement).getBoundingClientRect();
    const supported = r.left - l.right > 1;
    document.body.removeChild(test);
    if (supported) return;
  } catch {
    return; // 检测失败保守跳过，不垫
  }

  let scheduled = false;
  const patch = () => {
    scheduled = false;
    document.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const st = getComputedStyle(el);
      if (st.display !== 'flex' && st.display !== 'inline-flex') return;
      const cg = parseFloat(st.columnGap) || 0;
      const rg = parseFloat(st.rowGap) || 0;
      if (!cg && !rg) return;
      const kids = Array.from(el.children) as HTMLElement[];
      kids.forEach((child, i) => {
        if (cg) child.style.marginRight = i < kids.length - 1 ? `${cg}px` : '';
        if (rg) child.style.marginBottom = `${rg}px`;
      });
    });
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(patch);
  };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
}

/** Chrome 69+ 才有 Array.flat/flatMap；MUI 样式引擎内部分支用到，Chrome 61 上缺了会崩。能力检测后补最小实现 */
function installArrayPolyfills(): void {
  const AP = Array.prototype as unknown as Record<string, unknown>;
  if (typeof AP.flat !== 'function') {
    AP.flat = function (this: unknown[], depth?: number) {
      let arr = this as unknown[];
      const d = depth === undefined ? 1 : Math.floor(depth);
      for (let i = 0; i < d; i++) arr = ([] as unknown[]).concat(...arr);
      return arr;
    };
  }
  if (typeof AP.flatMap !== 'function') {
    AP.flatMap = function (this: unknown[], cb: (...a: unknown[]) => unknown, thisArg?: unknown) {
      return ([] as unknown[]).concat(...this.map(cb, thisArg));
    };
  }
}

/**
 * 字体收敛已改为构建期处理（build-mini.sh 在 style.css / app.js 里把 Noto/Roboto/楷体
 * 等名字替换成系统黑体、宋体），运行期不再用 `*{font-family:...!important}` 强制全局无衬线——
 * 那条规则会把帖名、数字、问题句的宋体一起压掉，帖页排版就只剩一种字体。
 */
export function installMiniCompat(): void {
  installArrayPolyfills();
  installFlexGapPolyfill();
}
