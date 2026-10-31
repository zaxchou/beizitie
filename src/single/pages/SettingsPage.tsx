import React, { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { APP_VERSION, BUILD_DATE } from '@/core/version';
import { clearImageCache, imageCacheCount } from '@/data/local/imageCache';
import { kvGet, kvSet } from '@/data/local/db';
import SettingsBackupCard from '@settings/backup-card';

interface Props {
  darkMode: 'system' | 'light' | 'dark';
  onDarkModeChange: (m: 'system' | 'light' | 'dark') => void;
  onChanged?: () => void;
}

const mono = { fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' } as const;

const labelSx = {
  ...mono,
  fontSize: 9.5,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  opacity: 0.6,
  display: 'block',
  mb: 1,
} as const;

const DARK_OPTIONS: { key: 'system' | 'light' | 'dark'; label: string }[] = [
  { key: 'system', label: '跟随系统' },
  { key: 'light', label: '浅色' },
  { key: 'dark', label: '深色' },
];

export const SettingsPage: React.FC<Props> = ({ darkMode, onDarkModeChange, onChanged }) => {
  const [msg, setMsg] = useState<{ sev: 'success' | 'error'; text: string } | null>(null);

  // 字图离线缓存
  const [imgCacheOn, setImgCacheOn] = useState(true);
  const [imgCacheCount, setImgCacheCount] = useState<number | null>(null);
  useEffect(() => {
    void kvGet('imageCacheEnabled').then((v) => setImgCacheOn((v as boolean) ?? true));
    void imageCacheCount().then(setImgCacheCount);
  }, []);
  const handleImgCacheToggle = async (on: boolean) => {
    setImgCacheOn(on);
    await kvSet('imageCacheEnabled', on);
  };
  const handleClearCache = async () => {
    await clearImageCache();
    setImgCacheCount(0);
    setMsg({ sev: 'success', text: '字图缓存已清空' });
  };

  return (
    <Box>
      {/* 页头 */}
      <Box sx={{ pb: { xs: 1.5, md: 1.75 } }}>
        <Typography component="h1" sx={{ fontSize: { xs: 30, md: 44 }, fontWeight: 900, letterSpacing: { xs: '4px', md: '7px' }, lineHeight: 1.1 }}>
          设置
        </Typography>
        <Typography sx={{ ...mono, fontSize: 11, opacity: 0.72, mt: 1 }}>
          {__MINI__ ? '离线版' : '单文件版'} · 数据仅存本机
          {APP_VERSION !== 'dev' && ` · v${APP_VERSION}`}
        </Typography>
      </Box>

      {msg && (
        <Box
          component="button"
          type="button"
          onClick={() => setMsg(null)}
          sx={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            border: '1px solid',
            borderColor: msg.sev === 'error' ? 'var(--hot-ink)' : 'text.primary',
            background: 'none',
            color: msg.sev === 'error' ? 'var(--hot-ink)' : 'inherit',
            p: '8px 12px',
            mb: 1.5,
            cursor: 'pointer',
            ...mono,
            fontSize: 11,
          }}
        >
          {msg.text}
        </Box>
      )}

      {/* 外观 */}
      <Box sx={{ borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'text.primary', py: 1.75 }}>
        <Typography sx={labelSx}>外观 · Appearance</Typography>
        <Box sx={{ display: 'flex' }}>
          {DARK_OPTIONS.map((o, i) => {
            const on = darkMode === o.key;
            return (
              <Box
                key={o.key}
                component="button"
                type="button"
                onClick={() => onDarkModeChange(o.key)}
                aria-pressed={on}
                sx={{
                  flex: { xs: 1, md: '0 0 auto' },
                  border: '1px solid',
                  borderColor: on ? 'text.primary' : 'divider',
                  borderLeftWidth: i === 0 ? 1 : 0,
                  bgcolor: on ? 'text.primary' : 'transparent',
                  color: on ? 'background.default' : 'inherit',
                  height: 34,
                  px: { xs: 0, md: 2 },
                  cursor: 'pointer',
                  fontSize: 13,
                  '&:hover': on ? {} : { borderColor: 'text.primary' },
                }}
              >
                {o.label}
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* 备份 */}
      <Box sx={{ py: 2 }}>
        <SettingsBackupCard onChanged={onChanged} />
      </Box>

      {/* 字图缓存 */}
      {!__MINI__ && (
        <Box sx={{ borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'text.primary', py: 1.75, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 14 }}>字图离线缓存</Typography>
            <Typography sx={{ ...mono, fontSize: 10, opacity: 0.55, mt: 0.4 }}>
              学习过的字图存到本机{imgCacheCount !== null ? ` · 已缓存 ${imgCacheCount} 张` : ''}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
            <Box
              component="button"
              type="button"
              onClick={() => handleImgCacheToggle(!imgCacheOn)}
              aria-pressed={imgCacheOn}
              sx={{
                border: '1px solid',
                borderColor: imgCacheOn ? 'text.primary' : 'divider',
                bgcolor: imgCacheOn ? 'text.primary' : 'transparent',
                color: imgCacheOn ? 'background.default' : 'inherit',
                ...mono,
                fontSize: 11,
                height: 28,
                px: 1.1,
                cursor: 'pointer',
              }}
            >
              {imgCacheOn ? '开' : '关'}
            </Box>
            <Box
              component="button"
              type="button"
              onClick={handleClearCache}
              disabled={!imgCacheCount}
              sx={{
                border: 0,
                background: 'none',
                color: 'inherit',
                p: 0,
                cursor: imgCacheCount ? 'pointer' : 'not-allowed',
                opacity: imgCacheCount ? 0.72 : 0.35,
                ...mono,
                fontSize: 11,
                '&:hover': imgCacheCount ? { opacity: 1, textDecoration: 'underline' } : {},
              }}
            >
              清空缓存
            </Box>
          </Box>
        </Box>
      )}

      {/* 关于 */}
      <Box sx={{ pt: 2.5 }}>
        <Typography sx={labelSx}>关于 · About</Typography>
        <Typography sx={{ ...mono, fontSize: 10.5, lineHeight: 2, opacity: 0.72 }}>
          背字帖{__MINI__ ? '' : ' · 单文件开源版'}（MIT）
          {APP_VERSION !== 'dev' && <> · v{APP_VERSION}{BUILD_DATE ? `（${BUILD_DATE} 构建）` : ''}</>}
          <br />
          {__MINI__ ? (
            <>
              书法内容：古代碑帖临本，原作已属公有领域。
              <br />
              界面字体：系统黑体 / 宋体。
              <br />
              本工具不联网，不收集、不上传任何个人数据。
            </>
          ) : (
            <>碑帖单字图来自公开字库 CDN，仅供学习</>
          )}
          <br />
          {__MINI__ ? (
            '学习进度自动保存'
          ) : (
            <>
              学习记录仅存本机 ·{' '}
              <a href="https://github.com/zaxchou/beizitie/releases" target="_blank" rel="noreferrer" style={{ color: 'var(--vermilion)' }}>
                GitHub · 更新日志
              </a>
            </>
          )}
        </Typography>
      </Box>
    </Box>
  );
};

export default SettingsPage;
