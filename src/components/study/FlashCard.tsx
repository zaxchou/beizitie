import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '@mui/material';
import type { Card } from '@/types';
import { getImageUrl } from '@/lib/imageUrl';
import { parseAtlasUrl, atlasBgPosition } from '@/core/types';
import OriginalPageView from '@/components/study/OriginalPageView';

export interface FlashCardProps {
  card: Card;
  flipped: boolean;
  onFlip: () => void;
  /** 填满父容器高度（学习页的字幅区用）；默认按内容高度 */
  fill?: boolean;
  /** 无卡片外框（学习页桌面：字幅直接落在纸面上） */
  bare?: boolean;
}

/** 安全渲染 HTML（仅允许 img/br/b/i/u/p/div/span，过滤 script/onerror/onclick 等） */
function sanitizeHtml(text: string): string {
  if (!text) return '';
  return text
    // 剥离 script 标签及内容
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // 剥离 on* 事件处理器 (onclick, onerror, onload, ...)
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    // 剥离危险的标签属性（javascript: 伪协议）
    .replace(/\s*(?:href|src)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '')
    // 剥离 style 中的 expression()
    .replace(/expression\s*\(/gi, '');
}

const FlashCard: React.FC<FlashCardProps> = ({ card, flipped, onFlip, fill = false, bare = false }) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [viewingOriginal, setViewingOriginal] = useState(false);
  // mini 离线包：字图为 4×4 图集切片，量出卡内可用空间后以正方形显示（防拉伸、兼容 Chrome 61 无 aspect-ratio）
  const atlas = __MINI__ ? parseAtlasUrl(card.image_url) : null;
  const atlasBoxRef = useRef<HTMLDivElement | null>(null);
  const [tileSide, setTileSide] = useState(0);
  useLayoutEffect(() => {
    if (!__MINI__ || !atlas) return;
    const measure = () => {
      const el = atlasBoxRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setTileSide(Math.max(0, Math.min(r.width, r.height) - 32));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [atlas, flipped]);

  // 卡面走主题令牌，深浅色与整站同一套纸墨
  const faceStyle: React.CSSProperties = {
    backgroundColor: theme.palette.background.paper,
    borderColor: theme.palette.divider,
  };

  // 判断文本是否包含 HTML 标签 → 需要 HTML 渲染
  const frontHasHtml = useMemo(() => /<[a-z][\s\S]*>/i.test(card.front_text), [card.front_text]);
  const backHasHtml = useMemo(() => /<[a-z][\s\S]*>/i.test(card.back_text), [card.back_text]);

  const frontSanitized = useMemo(() => sanitizeHtml(card.front_text), [card.front_text]);
  const backSanitized = useMemo(() => sanitizeHtml(card.back_text), [card.back_text]);

  return (
    <div className="w-full flex justify-center" style={fill ? { flex: 1, minHeight: 0, flexDirection: 'column' } : undefined}>
      <div className="relative w-full max-w-2xl" style={fill ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, margin: '0 auto' } : undefined}>
        {!flipped ? (
          /* 正面：只渲染印刷字，不挂任何答案图（不做 3D 翻转，避免翻面中途露答案） */
          <div
            className="flex items-center justify-center cursor-pointer select-none"
            style={{
              ...faceStyle,
              border: bare ? 'none' : '1px solid',
              backgroundColor: bare ? 'transparent' : faceStyle.backgroundColor,
              borderRadius: 0,
              minHeight: bare ? 0 : 280,
              padding: bare ? 0 : 16,
              flex: fill ? 1 : undefined,
            }}
            onClick={onFlip}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFlip(); } }}
            aria-label={`${card.front_text}，查看原帖`}
          >
            {frontHasHtml ? (
              <span className="card-front-text text-center px-4 break-all" dangerouslySetInnerHTML={{ __html: frontSanitized }} />
            ) : (
              <span className="card-front-text text-center px-4 break-all" style={{ fontSize: card.front_text.length <= 2 ? (bare ? 'clamp(104px, 34vh, 340px)' : 'clamp(72px, 22vh, 176px)') : undefined }}>{card.front_text}</span>
            )}
          </div>
        ) : (
          /* 背面：揭晓后才挂载，图片才开始请求 */
          <div
            ref={atlasBoxRef}
            className="relative flex items-center justify-center overflow-hidden"
            style={{
              backgroundColor: bare ? 'transparent' : (isDark ? theme.palette.background.default : theme.palette.background.paper),
              border: bare ? 'none' : '1px solid',
              borderColor: theme.palette.divider,
              borderRadius: 0,
              minHeight: bare ? 0 : 280,
              flex: fill ? 1 : undefined,
            }}
          >
            {card.image_url ? (
              atlas ? (
                <div
                  aria-label={`书法：${card.front_text}`}
                  style={{
                    width: tileSide, height: tileSide,
                    backgroundImage: `url(${atlas.atlas})`,
                    backgroundSize: '400% 400%',
                    backgroundPosition: atlasBgPosition(atlas),
                    backgroundRepeat: 'no-repeat',
                  }}
                />
              ) : (
                <img
                  src={getImageUrl(card.image_url)}
                  alt={`书法：${card.front_text}`}
                  className={bare ? 'object-contain max-h-full max-w-full' : 'object-contain max-h-full max-w-full p-4'}
                  style={bare ? { width: '100%', height: '100%', objectFit: 'contain' } : undefined}
                  draggable={false}
                />
              )
            ) : __MINI__ && card.front_text ? (
              // 纯文字诊断版：无字图，正面汉字用系统楷体大字展示
              <span aria-label={`汉字：${card.front_text}`} className="font-kai" style={{ fontSize: 120, lineHeight: 1.2 }}>{card.front_text}</span>
            ) : card.back_text ? (
              backHasHtml ? (
                <span className="card-front-text text-center px-4 break-all" dangerouslySetInnerHTML={{ __html: backSanitized }} />
              ) : (
                <span className="card-front-text text-center px-4 break-all">{card.back_text}</span>
              )
            ) : (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>暂无内容</p>
            )}
            {/* 字在帖中（馆方来源帖才有 context）：点角标看整页原拓 */}
            {card.context && (
              <button
                type="button"
                aria-label="查看该字在整页原拓中的位置"
                title="字在帖中 · 查看整页原拓"
                onClick={(e) => { e.stopPropagation(); setViewingOriginal(true); }}
                className="absolute bottom-2 right-2 z-10 px-1.5 py-0.5 text-[10px] font-bold leading-tight"
                style={{ backgroundColor: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: '2px' }}
              >
                原拓
              </button>
            )}
          </div>
        )}
      </div>
      {viewingOriginal && card.context && (
        <OriginalPageView char={card.front_text} context={card.context} onClose={() => setViewingOriginal(false)} />
      )}
    </div>
  );
};

export default FlashCard;
