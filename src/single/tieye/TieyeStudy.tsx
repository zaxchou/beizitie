import { useEffect, useMemo, useRef, useState } from 'react';
import { atlasBgPosition, parseAtlasUrl } from '@/core/types';
import type { StudyQueue } from '@/data/adapter';
import { localDataSource } from '@/data/local/localAdapter';
import { calculateNextReview, createInitialSM2State } from '@/lib/sm2';
import type { Rating } from '@/types';
import ConfirmDialog from '@/components/common/ConfirmDialog';

export interface TieyeStudyProps {
  deck: { id: string; name: string; author: string; dynasty: string };
  onExit: () => void;
}

interface Session {
  deckId: string;
  status: 'loading' | 'ready' | 'error';
  items: StudyQueue['items'];
  index: number;
  saved: number;
}

const ratings: { value: Rating; label: string }[] = [
  { value: 1, label: '重来' },
  { value: 2, label: '困难' },
  { value: 3, label: '良好' },
  { value: 4, label: '简单' },
];

// Keep the display units identical to the existing RatingButtons.
function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes}分钟`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}小时`;
  if (minutes < 43200) return `${Math.round(minutes / 1440)}天`;
  return `${Math.round(minutes / 43200)}个月`;
}

function isLocalImage(source: string): boolean {
  if (!source) return false;
  try {
    const url = new URL(source, window.location.href);
    if (url.protocol === 'data:') return source.startsWith('data:image/');
    if (url.protocol === 'blob:') return url.origin === window.location.origin;
    if (url.protocol === 'file:') return window.location.protocol === 'file:';
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.origin === window.location.origin;
  } catch {
    return false;
  }
}

export default function TieyeStudy({ deck, onExit }: TieyeStudyProps) {
  const [session, setSession] = useState<Session>({
    deckId: deck.id, status: 'loading', items: [], index: 0, saved: 0,
  });
  const [queueAttempt, setQueueAttempt] = useState(0);
  const [revealedCardId, setRevealedCardId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [image, setImage] = useState<{ key: string; status: 'ready' | 'error' } | null>(null);
  const submitLock = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const promptRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // 本轮用时（与 StudyPage 一致的 mm:ss）
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  useEffect(() => {
    let active = true;
    generation.current += 1;
    submitLock.current = false;
    setSaving(false);
    setSaveError(false);
    setRevealedCardId(null);
    setImage(null);
    setElapsed(0);
    setSession({ deckId: deck.id, status: 'loading', items: [], index: 0, saved: 0 });

    async function loadQueue() {
      try {
        const queue = await localDataSource.study.queue(deck.id);
        if (active) {
          setSession({ deckId: deck.id, status: 'ready', items: queue.items, index: 0, saved: 0 });
        }
      } catch {
        if (active) {
          setSession({ deckId: deck.id, status: 'error', items: [], index: 0, saved: 0 });
        }
      }
    }
    void loadQueue();
    return () => { active = false; };
  }, [deck.id, queueAttempt]);

  const loading = session.deckId !== deck.id || session.status === 'loading';
  const current = !loading && session.status === 'ready' ? session.items[session.index] : undefined;
  const cardId = current?.card.id;
  const revealed = !!current && revealedCardId === cardId;
  const atlas = revealed && current ? parseAtlasUrl(current.card.imageUrl) : null;
  const imageSrc = revealed && current ? (atlas?.atlas ?? current.card.imageUrl) : '';
  const imageKey = JSON.stringify([cardId, imageSrc, imageAttempt]);
  const imageStatus = image?.key === imageKey ? image.status : 'loading';
  const done = !loading && session.status === 'ready' && !current;

  const previews = useMemo(() => {
    const input = current?.progress ?? createInitialSM2State();
    return ratings.map(({ value }) => formatInterval(calculateNextReview(value, input).interval));
  }, [current]);

  // A successful save remains locked until the next card has actually committed.
  useEffect(() => {
    submitLock.current = false;
    setSaving(false);
  }, [cardId]);

  useEffect(() => {
    if (cardId) promptRef.current?.focus();
  }, [cardId, revealed]);

  // No answer image or image request exists until the user reveals this card.
  useEffect(() => {
    if (!revealed) return;
    let active = true;
    if (!isLocalImage(imageSrc)) {
      setImage({ key: imageKey, status: 'error' });
      return () => { active = false; };
    }
    const loader = new Image();
    loader.onload = () => {
      if (active) setImage({ key: imageKey, status: loader.naturalWidth > 0 ? 'ready' : 'error' });
    };
    loader.onerror = () => {
      if (active) setImage({ key: imageKey, status: 'error' });
    };
    loader.src = imageSrc;
    return () => {
      active = false;
      loader.onload = null;
      loader.onerror = null;
    };
  }, [revealed, imageSrc, imageKey]);

  async function rate(rating: Rating) {
    if (!current || !revealed || submitLock.current) return;
    submitLock.current = true;
    setSaving(true);
    setSaveError(false);
    const requestGeneration = generation.current;
    const ratedId = current.card.id;
    try {
      await localDataSource.study.rate(ratedId, rating);
      if (!mounted.current || generation.current !== requestGeneration) return;
      setSession((previous) => {
        if (previous.items[previous.index]?.card.id !== ratedId) return previous;
        return { ...previous, index: previous.index + 1, saved: previous.saved + 1 };
      });
    } catch {
      if (!mounted.current || generation.current !== requestGeneration) return;
      submitLock.current = false;
      setSaving(false);
      setSaveError(true);
    }
  }

  return (
    <section className="te-study" aria-label={`${deck.name} · 习字`}>
      <header className="te-study-header">
        <button
          className="te-study-back"
          type="button"
          onClick={() => (session.saved > 0 && !done ? setConfirmExit(true) : onExit())}
        >
          <span aria-hidden="true">← </span>书库
        </button>
        <div className="te-study-heading">
          <h1 className="te-study-title">{deck.name}</h1>
          <p className="te-study-meta">{[deck.dynasty, deck.author].filter(Boolean).join(' · ')}</p>
        </div>
        <span className="te-study-seal" aria-hidden="true">温故</span>
      </header>

      {!loading && session.status === 'ready' && (
        <div className="te-study-progress">
          <span className="te-study-count">
            {done ? `已保存 ${session.saved} 字` : `第 ${session.index + 1} 字 / 共 ${session.items.length} 字`}
          </span>
          <progress
            className="te-progress"
            value={session.saved}
            max={Math.max(1, session.items.length)}
            aria-label={`本轮已保存 ${session.saved} 字，共 ${session.items.length} 字`}
          />
          <span className="te-study-timer" aria-label={`本轮已用时 ${clock}`}>{clock}</span>
          {current && (
            <span className="te-study-kind">{current.progress ? '复习' : '初识'}</span>
          )}
        </div>
      )}

      {loading ? (
        <div className="te-study-sheet te-study-status" role="status">正在展帖…</div>
      ) : session.status === 'error' ? (
        <div className="te-study-sheet te-study-error" role="alert">
          <p>暂时无法读取本轮字卡，请重试。</p>
          <button className="te-study-retry" type="button" onClick={() => setQueueAttempt((n) => n + 1)}>
            重新加载
          </button>
        </div>
      ) : done ? (
        <div className="te-study-sheet te-study-done" role="status">
          <p className="te-study-step">习字小记</p>
          <h2>本轮完成</h2>
          <p className="te-study-complete-count">本轮已保存 {session.saved} 字</p>
          {session.items.length === 0 && <p className="te-study-hint">这本帖今日暂无待学字卡。</p>}
          <button className="te-study-return" type="button" onClick={onExit}>返回书库</button>
        </div>
      ) : current ? (
        <article
          key={current.card.id}
          className={`te-study-sheet te-study-card${revealed ? '' : ' te-study-card--front'}`}
          aria-busy={saving}
        >
          {revealed ? (
            <>
              <div className="te-study-answer">
                <div className="te-study-stage" aria-busy={imageStatus === 'loading'}>
                  {imageStatus === 'ready' ? (
                    atlas ? (
                      <div
                        className="te-glyph te-glyph--atlas"
                        role="img"
                        aria-label={`「${current.card.hanzi}」的原帖字形`}
                        style={{
                          backgroundImage: `url(${JSON.stringify(atlas.atlas)})`,
                          backgroundSize: '400% 400%',
                          backgroundPosition: atlasBgPosition(atlas),
                          backgroundRepeat: 'no-repeat',
                        }}
                      />
                    ) : (
                      <img
                        className="te-glyph te-glyph--image"
                        src={imageSrc}
                        alt={`「${current.card.hanzi}」的原帖字形`}
                        draggable={false}
                        onError={() => setImage({ key: imageKey, status: 'error' })}
                      />
                    )
                  ) : imageStatus === 'error' ? (
                    <div className="te-study-error" role="alert">
                      <p>原帖图暂时无法显示，请确认本地字图可用后重试。</p>
                      <button className="te-study-retry" type="button" onClick={() => setImageAttempt((n) => n + 1)}>
                        重试字图
                      </button>
                    </div>
                  ) : (
                    <p className="te-study-status" role="status">正在展现原帖…</p>
                  )}
                </div>
              </div>
              <h2 className="te-study-prompt" ref={promptRef} tabIndex={-1}>这个字，记住了吗？</h2>
              {saveError && (
                <p className="te-study-error" role="alert">评分保存未完成，请重新选择下方任一评分重试。</p>
              )}
              <div className="te-study-ratings" role="group" aria-label="这个字，记住了吗？">
                {ratings.map(({ value, label }, index) => (
                  <button
                    key={value}
                    className="te-study-rating"
                    type="button"
                    disabled={saving}
                    onClick={() => { void rate(value); }}
                    aria-label={`${label}，${previews[index]}后复习`}
                  >
                    <span className="te-study-rating-label">{label}</span>
                    <span className="te-study-interval">{previews[index]}</span>
                  </button>
                ))}
              </div>
              {saving && <p className="te-study-status" role="status">正在保存评分…</p>}
            </>
          ) : (
            <>
              <div className="te-study-stage">
                <span className="te-glyph te-glyph--printed">{current.card.hanzi}</span>
              </div>
              <h2 className="te-study-prompt" ref={promptRef} tabIndex={-1}>看字回想</h2>
              <p className="te-study-hint">思考此字的结构与笔势</p>
              <button
                className="te-study-reveal"
                type="button"
                onClick={() => setRevealedCardId(current.card.id)}
              >
                查看原帖
              </button>
            </>
          )}
        </article>
      ) : null}

      <ConfirmDialog
        open={confirmExit}
        title="中断本轮"
        message={`本轮已保存 ${session.saved} 字，中断后已评分的进度会保留。确定返回书库吗？`}
        onConfirm={() => { setConfirmExit(false); onExit(); }}
        onCancel={() => setConfirmExit(false)}
      />
    </section>
  );
}
