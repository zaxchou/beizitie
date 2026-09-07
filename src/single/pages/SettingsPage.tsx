import React, { useEffect, useState } from 'react';
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
import { APP_VERSION, BUILD_DATE } from '@/core/version';
import { clearImageCache, imageCacheCount } from '@/data/local/imageCache';
import { kvGet, kvSet } from '@/data/local/db';
import SettingsBackupCard from '@settings/backup-card';

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

      <SettingsBackupCard onChanged={onChanged} />

      {/* 字图离线缓存（mini 全字图已内置，无网络缓存概念） */}
      {!__MINI__ && (
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
      )}

      {/* 关于 */}
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>关于</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.8 }}>
            背字帖 · {__MINI__ ? '离线版' : '单文件开源版'}（MIT）{APP_VERSION !== 'dev' && <> · v{APP_VERSION}{BUILD_DATE ? `（${BUILD_DATE} 构建）` : ''}</>}
            <br />
            {__MINI__
              ? <>【内容来源与授权】
                  <br />碑帖拓片：上海图书馆藏本《九成宫醴泉铭》《集王圣教序》，依 CC BY-NC-ND 3.0 署名使用，非商业学习用途，裁剪缩放仅用于本工具内展示。
                  <br />界面字体：霞鹜文楷（SIL OFL 1.1），许可见包内 fonts/OFL.json。
                  <br />本工具不联网，不收集、不上传任何个人数据。</>
              : <>碑帖单字图来自公开字库 CDN，仅供学习</>}
            <br />
            {__MINI__
              ? '进度仅存本机'
              : <>学习记录仅存本机 · <a href="https://github.com/zaxchou/beizitie/releases" target="_blank" rel="noreferrer">GitHub · 更新日志</a></>}
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};

export default SettingsPage;
