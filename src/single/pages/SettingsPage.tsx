import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Chip,
  Alert,
  Switch,
} from '@mui/material';
import { localDataSource } from '@/data/local/localAdapter';
import { clearImageCache, imageCacheCount } from '@/data/local/imageCache';
import { kvGet, kvSet } from '@/data/local/db';

interface Props {
  darkMode: 'system' | 'light' | 'dark';
  onDarkModeChange: (m: 'system' | 'light' | 'dark') => void;
  onChanged?: () => void;
}

const DARK_OPTIONS: { key: 'system' | 'light' | 'dark'; label: string }[] = [
  { key: 'system', label: '跟随系统' },
  { key: 'light', label: '浅色' },
  { key: 'dark', label: '深色' },
];

export const SettingsPage: React.FC<Props> = ({ darkMode, onDarkModeChange, onChanged }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
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

  const handleExport = async () => {
    setBusy(true);
    try {
      const blob = await localDataSource.backup.exportAll();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `beizitie-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg({ sev: 'success', text: '备份已导出' });
    } catch (e: any) {
      setMsg({ sev: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const report = await localDataSource.backup.importAll(text, 'merge');
      setMsg({ sev: 'success', text: `导入完成：${report.decks} 个牌组、${report.cards} 张卡、${report.progress} 条进度` });
      onChanged?.();
    } catch (e: any) {
      setMsg({ sev: 'error', text: `导入失败：${e.message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box className="space-y-3">
      <Typography className="font-kai" sx={{ fontSize: 20, fontWeight: 700 }}>设置</Typography>

      {msg && <Alert severity={msg.sev} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      {/* 外观 */}
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 1.5 }}>外观</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {DARK_OPTIONS.map((o) => (
              <Chip
                key={o.key} label={o.label} size="small"
                color={darkMode === o.key ? 'primary' : 'default'}
                variant={darkMode === o.key ? 'filled' : 'outlined'}
                onClick={() => onDarkModeChange(o.key)}
                sx={{ cursor: 'pointer' }}
              />
            ))}
          </Box>
        </CardContent>
      </Card>

      {/* 数据备份 */}
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>数据备份</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            学习记录只保存在本机浏览器中。定期导出 JSON 备份，换机或清缓存时可恢复。备份格式与在线版互通。
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="contained" onClick={handleExport} disabled={busy} sx={{ borderRadius: 2 }}>
              导出备份
            </Button>
            <Button variant="outlined" onClick={() => fileRef.current?.click()} disabled={busy} sx={{ borderRadius: 2 }}>
              导入备份
            </Button>
            <input
              ref={fileRef} type="file" accept=".json" hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
                e.target.value = '';
              }}
            />
          </Box>
        </CardContent>
      </Card>

      {/* 字图离线缓存 */}
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography sx={{ fontWeight: 600 }}>字图离线缓存</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                学习过的字图存到本机，断网也能复习
                {imgCacheCount !== null ? `（已缓存 ${imgCacheCount} 张）` : ''}
              </Typography>
            </Box>
            <Switch checked={imgCacheOn} onChange={(e) => handleImgCacheToggle(e.target.checked)} />
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
            <Button size="small" variant="text" color="error" onClick={handleClearCache} disabled={!imgCacheCount}>
              清空缓存
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* 关于 */}
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>关于</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.8 }}>
            背字帖 · 单文件开源版（MIT）
            <br />
            碑帖单字图来自公开字库 CDN，仅供学习
            <br />
            学习记录仅存本机 · <a href="https://github.com/zaxchou/beizitie" target="_blank" rel="noreferrer">GitHub</a>
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};

export default SettingsPage;
