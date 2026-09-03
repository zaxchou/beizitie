import { getImageUrl } from './api';
import { groupResults } from '@/components/jizi/JiziPreview';
import type { JiziMatchResult, JiziLayout } from '@/types/jizi';

/**
 * Canvas 导出集字作品为 PNG
 * 使用 2x devicePixelRatio 保证高清输出
 */
export async function exportJiziPNG(
  results: JiziMatchResult[],
  selections: number[],
  layout: JiziLayout,
  text?: string,
): Promise<void> {
  const { direction, fontSize, colCount, charGap, lineGap, background } = layout;

  if (results.length === 0) return;

  const cell = fontSize;
  const cg = Math.round(fontSize * charGap);
  const lg = Math.round(fontSize * lineGap);

  // 分组：与预览一致（手动分行优先，否则按 colCount）
  const groups = groupResults(results, colCount, text);
  const isVertical = direction.startsWith('vertical');
  const groupCount = groups.length;
  // 不同 group 长度可能不同（手动分行时），取最大长度作为画布尺寸基准
  const maxInGroup = groups.reduce((m, g) => Math.max(m, g.items.length), 0);

  const width = isVertical
    ? groupCount * cell + (groupCount - 1) * lg
    : maxInGroup * cell + (maxInGroup - 1) * cg;
  const height = isVertical
    ? maxInGroup * cell + (maxInGroup - 1) * cg
    : groupCount * cell + (groupCount - 1) * lg;

  const padding = 40;
  const totalW = width + padding * 2;
  const totalH = height + padding * 2;
  const dpr = 2;

  const canvas = document.createElement('canvas');
  canvas.width = totalW * dpr;
  canvas.height = totalH * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  // 背景
  const bgColors: Record<string, string> = {
    default: '#e6e6e6',
    xuan: '#f5ecd9',
    white: '#ffffff',
    ink: '#1a1a1a',
    vermilion: '#8b0000',
  };
  if (background === 'default') {
    const grad = ctx.createLinearGradient(0, 0, totalW, totalH);
    grad.addColorStop(0, '#e8e8e8');
    grad.addColorStop(0.5, '#d4d4d4');
    grad.addColorStop(1, '#c8c8c8');
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = bgColors[background] || '#ffffff';
  }
  ctx.fillRect(0, 0, totalW, totalH);

  // 预加载图片
  const urlSet = new Set<string>();
  results.forEach((r, i) => {
    const hit = r.hits[selections[i] ?? 0];
    if (hit) urlSet.add(getImageUrl(hit.image_url));
  });
  const imgMap = await loadImages(Array.from(urlSet));

  // 逐字绘制：从右往读时 group 保持原顺序（第一组6字+第二组2字），
  // 但坐标从右/下开始算，这样内容自然居右/居下
  const alignEnd = direction.endsWith('rl');

  groups.forEach((group, gi) => {
    group.items.forEach((result, ii) => {
      const globalIndex = group.offset + ii;

      let x: number, y: number;
      if (isVertical) {
        x = alignEnd
          ? padding + (groupCount - 1 - gi) * (cell + lg)
          : padding + gi * (cell + lg);
        y = padding + ii * (cell + cg);
      } else {
        x = padding + ii * (cell + cg);
        y = alignEnd
          ? padding + (groupCount - 1 - gi) * (cell + lg)
          : padding + gi * (cell + lg);
      }

      const hit = result.hits[selections[globalIndex] ?? 0];
      if (hit) {
        const img = imgMap.get(getImageUrl(hit.image_url));
        if (img) {
          drawContain(ctx, img, x, y, cell, cell);
        }
      } else {
        // 缺字：虚线方框
        ctx.strokeStyle = '#bbb';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x + 2, y + 2, cell - 4, cell - 4);
        ctx.setLineDash([]);
        ctx.fillStyle = '#999';
        ctx.font = `${Math.round(cell * 0.4)}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(result.char, x + cell / 2, y + cell / 2);
      }
    });
  });

  // 触发下载
  try {
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `jizi-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
      },
      'image/png',
    );
  } catch (err) {
    // Canvas 被跨域图片污染会抛 SecurityError
    throw new Error('导出失败：Canvas 跨域污染。请确认所有字图来自同源服务器。');
  }
}

function loadImages(urls: string[]): Promise<Map<string, HTMLImageElement>> {
  return Promise.all(
    urls.map(
      (u) =>
        new Promise<[string, HTMLImageElement]>((resolve, reject) => {
          const img = new Image();
          // 字库图 CDN（含跨域）已开 CORS；同源图片不受影响。不设置会导致 canvas 被污染无法导出
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve([u, img]);
          img.onerror = () => reject(new Error(`图片加载失败: ${u}`));
          img.src = u;
        }),
    ),
  ).then((list) => new Map(list));
}

function drawContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const ir = img.width / img.height;
  const cr = w / h;
  let dw = w;
  let dh = h;
  let dx = x;
  let dy = y;
  if (ir > cr) {
    dh = w / ir;
    dy = y + (h - dh) / 2;
  } else {
    dw = h * ir;
    dx = x + (w - dw) / 2;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}
