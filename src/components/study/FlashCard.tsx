import React, { useMemo, useState } from 'react';
import { useTheme } from '@mui/material';
import type { Card } from '@/types';
import { getImageUrl } from '@/lib/api';
import OriginalPageView from './OriginalPageView';

export interface FlashCardProps {
  card: Card;
  flipped: boolean;
  onFlip: () => void;
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

const FlashCard: React.FC<FlashCardProps> = ({ card, flipped, onFlip }) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [viewingOriginal, setViewingOriginal] = useState(false);

  const faceStyle: React.CSSProperties = {
    backgroundColor: isDark ? '#2d2d2d' : '#fff',
    borderColor: isDark ? '#444' : '#e5e7eb',
  };

  // 判断文本是否包含 HTML 标签 → 需要 HTML 渲染
  const frontHasHtml = useMemo(() => /<[a-z][\s\S]*>/i.test(card.front_text), [card.front_text]);
  const backHasHtml = useMemo(() => /<[a-z][\s\S]*>/i.test(card.back_text), [card.back_text]);

  const frontSanitized = useMemo(() => sanitizeHtml(card.front_text), [card.front_text]);
  const backSanitized = useMemo(() => sanitizeHtml(card.back_text), [card.back_text]);

  return (
    <div className="perspective-1000 w-full flex justify-center" style={{ perspective: '800px' }}>
      <div
        className="relative w-full max-w-lg cursor-pointer select-none"
        style={{ minHeight: '280px' }}
        onClick={onFlip}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFlip(); } }}
        aria-label={flipped ? '点击翻回正面' : '点击翻到背面'}
      >
        <div
          className="preserve-3d relative w-full h-64"
          style={{ minHeight: '280px', transition: 'transform 0.5s', transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
        >
          {/* 正面 */}
          <div className="backface-hidden absolute inset-0 flex items-center justify-center rounded-lg border" style={faceStyle}>
            {frontHasHtml ? (
              <span className="card-front-text text-center px-4 break-all" dangerouslySetInnerHTML={{ __html: frontSanitized }} />
            ) : (
              <span className="card-front-text text-center px-4 break-all">{card.front_text}</span>
            )}
          </div>

          {/* 背面：优先显示图片 */}
          <div
            className="backface-hidden rotate-y-180 absolute inset-0 flex items-center justify-center rounded-lg border card-image-back overflow-hidden"
            style={{ backgroundColor: isDark ? '#2d2d2d' : '#fafafa', borderColor: isDark ? '#444' : '#e5e7eb' }}
          >
            {card.image_url ? (
              <img src={getImageUrl(card.image_url)} alt={`书法：${card.front_text}`} className="object-contain max-h-full max-w-full p-4" draggable={false} />
            ) : card.back_text ? (
              backHasHtml ? (
                <span className="card-front-text text-center px-4 break-all" dangerouslySetInnerHTML={{ __html: backSanitized }} />
              ) : (
                <span className="card-front-text text-center px-4 break-all">{card.back_text}</span>
              )
            ) : (
              <p className="text-ink-light text-sm">暂无内容</p>
            )}
            {/* 字在帖中（馆方来源帖才有 context）：默认隐藏，点角标看整页原拓 */}
            {card.context && (
              <button
                type="button"
                aria-label="查看该字在整页原拓中的位置"
                title="字在帖中 · 查看整页原拓"
                onClick={(e) => { e.stopPropagation(); setViewingOriginal(true); }}
                className="absolute bottom-2 right-2 z-10 rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-tight"
                style={{ backgroundColor: 'rgba(224,178,95,0.92)', color: '#3b2a10' }}
              >
                原拓
              </button>
            )}
          </div>
        </div>
      </div>
      {viewingOriginal && card.context && (
        <OriginalPageView char={card.front_text} context={card.context} onClose={() => setViewingOriginal(false)} />
      )}
    </div>
  );
};

export default FlashCard;
