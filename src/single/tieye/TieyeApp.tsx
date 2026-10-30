import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createTheme, ThemeProvider, useMediaQuery } from '@mui/material';
import JiziPage from '../pages/JiziPageMini';
import SettingsPage from '../pages/SettingsPage';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { localDataSource, catalogIndex, resyncBundledImages } from '@/data/local/localAdapter';
import { kvGet, kvSet } from '@/data/local/db';
import { atlasBgPosition, parseAtlasUrl } from '@/core/types';
import type { LocalDailyStat } from '@/core/types';
import TieyeStudy from './TieyeStudy';
import './tieye.css';
import TieyeDeckSettings from './TieyeDeckSettings';

type Deck = Awaited<ReturnType<typeof localDataSource.library.list>>[number];
type Tab = 'library' | 'jizi' | 'data' | 'settings';
type DarkMode = 'system' | 'light' | 'dark';

const tabs: { key: Tab; text: string }[] = [
  { key: 'library', text: '背字帖' }, { key: 'jizi', text: '集字' },
  { key: 'data', text: '数据' }, { key: 'settings', text: '设置' },
];

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function Stamp() {
  return <span className="te-stamp" aria-hidden="true"><span>字</span></span>;
}

function Glyph({ url, label }: { url: string; label: string }) {
  const ref = parseAtlasUrl(url);
  return ref ? <span role="img" aria-label={label} className="te-mini-glyph" style={{
    backgroundImage: `url(${ref.atlas})`, backgroundSize: '400% 400%', backgroundPosition: atlasBgPosition(ref),
  }} /> : <span className="te-mini-glyph te-mini-glyph--text" aria-hidden="true">字</span>;
}

export default function TieyeApp() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [studying, setStudying] = useState<Deck | null>(null);
  const [tab, setTab] = useState<Tab>('library');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [glyphs, setGlyphs] = useState<Record<string, string>>({});
  const [heroGlyphs, setHeroGlyphs] = useState<Record<string, { h: string; url: string }[]>>({});
  const [today, setToday] = useState({ studied: 0, newLearned: 0 });
  const [history, setHistory] = useState<LocalDailyStat[]>([]);
  const [allStats, setAllStats] = useState<LocalDailyStat[]>([]);
  const [notice, setNotice] = useState('');
  const [settingsFor, setSettingsFor] = useState<Deck | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Deck | null>(null);
  const [darkMode, setDarkMode] = useState<DarkMode>(() => {
    const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem('beizitie-dark');
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  });
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const mode: 'light' | 'dark' = darkMode === 'system' ? (prefersDark ? 'dark' : 'light') : darkMode;

  useEffect(() => {
    try { localStorage.setItem('beizitie-dark', darkMode); } catch { /* 隐私模式下忽略 */ }
  }, [darkMode]);

  // 弹层（Dialog）挂在 body 下，拿不到 .tieye 的变量，用 html 属性同步主题
  useEffect(() => {
    document.documentElement.setAttribute('data-tieye', mode);
  }, [mode]);

  const theme = useMemo(() => {
    const dark = mode === 'dark';
    return createTheme({
      palette: {
        mode,
        primary: { main: dark ? '#c2604f' : '#8b3a30' },
        background: { default: dark ? '#1c1a17' : '#f5f1e9', paper: dark ? '#242119' : '#fcfaf5' },
        text: { primary: dark ? '#e8e2d5' : '#302c25', secondary: dark ? '#a49b8b' : '#6e6458' },
        divider: dark ? '#3b352c' : '#d7cec0',
      },
      typography: {
        fontFamily: '"Microsoft YaHei", "SimHei", sans-serif', fontSize: 14,
        h1: { fontFamily: 'SimSun, "Songti SC", serif' }, h2: { fontFamily: 'SimSun, "Songti SC", serif' },
      },
      shape: { borderRadius: 2 },
      components: {
        MuiButton: { styleOverrides: { root: { minHeight: 44, textTransform: 'none', boxShadow: 'none' } } },
        MuiCard: { styleOverrides: { root: { boxShadow: 'none', borderColor: dark ? '#3b352c' : '#d6cec0' } } },
        MuiTextField: { defaultProps: { size: 'small' } },
      },
    });
  }, [mode]);

  const initRef = useRef<Promise<void> | null>(null);

  const reload = useCallback(async () => {
    const [list, stat, range, every] = await Promise.all([
      localDataSource.library.list(), localDataSource.stats.today(),
      localDataSource.stats.range(14), localDataSource.stats.range(9999),
    ]);
    setDecks(list);
    setToday(stat);
    setHistory(range);
    setAllStats(every);
    setSelectedId((id) => list.some((d) => d.id === id) ? id : list[0]?.id || '');
    const samples: Record<string, string> = {};
    const heroes: Record<string, { h: string; url: string }[]> = {};
    for (const d of list) {
      const z = await localDataSource.catalog.zitie(d.zitieId);
      const phrase = d.name.includes('瘦金') ? ['天', '地', '日', '月'] : ['永', '和', '九', '年'];
      samples[d.id] = z.g.find((g) => g.h === phrase[0])?.rel || z.g[0]?.rel || '';
      heroes[d.id] = phrase.map((h) => ({ h, url: z.g.find((g) => g.h === h)?.rel || '' })).filter((g) => g.url);
    }
    setGlyphs(samples);
    setHeroGlyphs(heroes);
  }, []);

  const initialize = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // 图地址迁移每次启动都跑：极轻（内存比对），兜住升级竞态
      await resyncBundledImages();
      // 数据版本 stamp：用户删掉的帖不会每次启动都复活（与 single/App.tsx 一致）
      const stamp = (catalogIndex as { updatedAt?: string }).updatedAt || '';
      const existing = await localDataSource.library.list();
      if ((await kvGet('miniDataStamp')) !== stamp) {
        for (const z of catalogIndex.zuopins) {
          if (existing.some((d) => d.zitieId === z.z)) continue;
          const manifest = await localDataSource.catalog.zitie(z.z);
          await localDataSource.library.addFromZitie(manifest, {
            name: z.n, author: z.a, dynasty: z.d, styles: z.s, cover: z.c,
          });
        }
        await kvSet('miniDataStamp', stamp);
      }
      await reload();
    } catch {
      setError('字帖暂时未能准备好，请重试。');
    } finally {
      setLoading(false);
    }
  }, [reload]);

  useEffect(() => {
    if (!initRef.current) initRef.current = initialize();
  }, [initialize]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selected = decks.find((d) => d.id === selectedId) || decks[0];
  const others = decks.filter((d) => d.id !== selected?.id);
  const total = decks.reduce((n, d) => n + d.totalCards, 0);
  const newCount = decks.reduce((n, d) => n + d.newCount, 0);
  const reviewCount = decks.reduce((n, d) => n + d.reviewCount, 0);
  const dueRemaining = decks.reduce((n, d) => n + d.dueRemaining, 0);
  const studyDays = allStats.filter((s) => s.studied > 0).length;
  const totalStudied = allStats.reduce((n, s) => n + s.studied, 0);

  const streak = useMemo(() => {
    const active = new Set(allStats.filter((s) => s.studied > 0).map((s) => s.date));
    const d = new Date();
    if (!active.has(dateKey(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (active.has(dateKey(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }, [allStats]);

  // stats.range 只返回有记录的日子，这里补齐成连续 14 天，否则单日记录会被拉成整条色块
  const days = useMemo(() => {
    const byDate = new Map(history.map((s) => [s.date, s]));
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      const key = dateKey(d);
      return { date: key, studied: byDate.get(key)?.studied ?? 0 };
    });
  }, [history]);
  const peak = Math.max(1, ...days.map((s) => s.studied));
  const todayKey = days[days.length - 1]?.date;
  const hasHistory = history.some((s) => s.studied);

  const exitStudy = () => {
    setStudying(null);
    void reload().catch(() => setNotice('进度显示暂未刷新，请稍后再试。'));
  };

  const saveDeckSettings = async (deck: Deck, patch: Parameters<typeof localDataSource.library.updateSettings>[1]) => {
    try {
      await localDataSource.library.updateSettings(deck.id, patch);
      setSettingsFor(null);
      await reload();
      setNotice('学习设置已更新');
    } catch {
      setNotice('设置未能保存，请重试。');
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await localDataSource.library.remove(target.id);
      setStudying((s) => (s?.id === target.id ? null : s));
      await reload();
      setNotice(`《${target.name}》已移出书库`);
    } catch {
      setNotice('删除未完成，请重试。');
    }
  };

  const paused = !!selected?.settings.paused;
  const startCount = selected ? selected.newCount + selected.reviewCount : 0;

  return (
    <ThemeProvider theme={theme}><div className="tieye" data-theme={mode}>
      <div className="te-shell">
        {studying ? <TieyeStudy deck={studying} onExit={exitStudy} /> : <>
          <header className="te-header">
            <a className="te-wordmark" href="#library" onClick={(e) => { e.preventDefault(); setTab('library'); }}>背字帖</a>
            <span className="te-motto">像背单词一样背字帖</span><Stamp />
          </header>
          <main className="te-main" id="te-main">
            {loading ? <section className="te-empty" role="status"><span className="te-loader" /><h1>正在展帖</h1><p>字帖准备好后即可开始。</p></section> : error ? <section className="te-empty" role="alert"><h1>暂未展帖</h1><p>{error}</p><button className="te-primary" onClick={() => void initialize()}>重新准备</button></section> : tab === 'library' && selected ? <>
              <section className="te-dayline" aria-label="今日学习概览">
                <div><strong>{newCount}</strong><span>可学<br />新字</span></div>
                <div><strong>{reviewCount}</strong><span>到期<br />复习</span></div>
                <p>{decks.length} 部字帖<br />共 {total} 字</p>
              </section>
              <section className="te-current" aria-label={`当前字帖 ${selected.name}`}>
                <div key={selected.id} className="te-book">
                  <div className={`te-book-image${selected.name.includes('瘦金') ? ' te-book-image--shoujin' : ''}`} aria-label={`${selected.name}原字选读`}><div className="te-cover-glyphs">{(heroGlyphs[selected.id] || []).map((g) => <Glyph key={g.h} url={g.url} label={`${selected.name}「${g.h}」原字`} />)}</div></div>
                  <div className="te-title-slip"><span className="te-slip-rule" /><h1 className={selected.name.length > 4 ? 'te-long-title' : undefined}>{selected.name}</h1><p>{selected.dynasty}<br />{selected.author}</p><span className="te-slip-mark">{paused ? '已暂停' : '当前字帖'}</span></div>
                </div>
                <div className="te-book-meta">
                  <span>{paused ? '已暂停复习' : <>本轮新学 <b>{selected.newCount}</b> 字</>}</span>
                  <span>已学 {selected.learnedCount} / {selected.totalCards}</span>
                </div>
                <div className="te-learning-line"><span style={{ width: `${selected.totalCards ? Math.min(100, selected.learnedCount / selected.totalCards * 100) : 0}%` }} /></div>
              </section>
              <div className="te-other-books" aria-label="切换字帖">{others.map((d) => <button key={d.id} className="te-other-book" onClick={() => setSelectedId(d.id)} aria-label={`选择${d.name}`}><Glyph url={glyphs[d.id] || ''} label={`${d.name}原字`} /><span className="te-other-info"><strong>{d.name}</strong><span>{d.dynasty} · {d.author} · {d.totalCards} 字</span></span><span className="te-arrow" aria-hidden="true">→</span></button>)}</div>
              <button className="te-primary te-begin" disabled={startCount === 0} onClick={() => setStudying(selected)}><span>开始背《{selected.name}》</span><span>{startCount} 字 <i aria-hidden="true">→</i></span></button>
              <div className="te-footnote">
                <p className="te-today-note">今日已学 {today.studied} 张<span>其中新学 {today.newLearned} 字</span></p>
                <button className="te-tool" type="button" onClick={() => setSettingsFor(selected)}>学习设置</button>
              </div>
            </> : tab === 'data' ? <section className="te-secondary"><h1>日课记录</h1><p className="te-secondary-lead">每次回想，都留下一点进展。</p>
              <dl className="te-records">
                <div><dt>今日已学</dt><dd>{today.studied}<small>张</small></dd></div>
                <div><dt>累计学习</dt><dd>{totalStudied}<small>张</small></dd></div>
                <div><dt>学习天数</dt><dd>{studyDays}<small>天</small></dd></div>
                <div><dt>连续打卡</dt><dd>{streak}<small>天</small></dd></div>
                <div><dt>待复习</dt><dd>{dueRemaining}<small>张</small></dd></div>
                <div><dt>我的字帖</dt><dd>{decks.length}<small>帖</small></dd></div>
              </dl>
              <h2>最近的日课</h2>
              {hasHistory ? <>
                <div className="te-spark" aria-hidden="true">{days.map((s) => <span key={s.date} className={s.date === todayKey ? 'is-today' : undefined}><i style={{ height: `${s.studied ? Math.max(9, Math.round(s.studied / peak * 100)) : 3}%` }} /></span>)}</div>
                <p className="te-spark-note"><span>近 14 天</span><span>今日 {today.studied} 张</span></p>
                <ol className="te-history">{history.filter((s) => s.studied).map((s) => <li key={s.date}><time>{s.date}</time><span>{s.studied} 张 · 新学 {s.newLearned} 字</span></li>)}</ol>
              </> : <p className="te-muted">完成第一张卡片后，这里会留下记录。</p>}
              <h2 className="te-decks-title">按帖进度</h2>
              <ul className="te-deck-progress">
                {decks.map((d) => {
                  const pct = d.totalCards ? Math.round(d.learnedCount / d.totalCards * 100) : 0;
                  return <li key={d.id}>
                    <div><strong>{d.name}</strong><span>{d.learnedCount} / {d.totalCards} · 待复习 {d.dueRemaining}</span></div>
                    <div className="te-learning-line"><span style={{ width: `${pct}%` }} /></div>
                  </li>;
                })}
              </ul>
            </section> : tab === 'settings' ? <section className="te-secondary te-existing-page"><SettingsPage darkMode={darkMode} onDarkModeChange={setDarkMode} /></section> : <section className="te-secondary te-existing-page"><JiziPage /></section>}
          </main>
          <nav className="te-nav" aria-label="功能导航">{tabs.map((item) => <button key={item.key} className={tab === item.key ? 'is-active' : ''} aria-current={tab === item.key ? 'page' : undefined} onClick={() => setTab(item.key)}><span>{item.text}</span><i /></button>)}</nav>
        </>}
        {notice && <div className="te-notice" role="status">{notice}</div>}
      </div>
      {settingsFor && (
        <TieyeDeckSettings
          deck={settingsFor}
          onClose={() => setSettingsFor(null)}
          onSave={(patch) => void saveDeckSettings(settingsFor, patch)}
          onDelete={() => { setConfirmDelete(settingsFor); setSettingsFor(null); }}
        />
      )}
      <ConfirmDialog
        open={!!confirmDelete}
        title="移出书库"
        message={`确定把《${confirmDelete?.name ?? ''}》移出书库？该帖的学习进度会一起删除，且无法恢复。`}
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmDelete(null)}
      />
    </div></ThemeProvider>
  );
}
