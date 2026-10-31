import React, { useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { localDataSource } from '@/data/local/localAdapter';

/** 单文件版：数据备份卡（导出/导入 JSON）。mini 构建经 alias 换成进度说明卡（容器禁下载/文件选择）。 */
export const SettingsBackupCard: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ sev: 'success' | 'error'; text: string } | null>(null);

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

  const mono = { fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' } as const;
  const btnSx = { ...mono, fontSize: 11, height: 34, px: 1.75 } as const;

  return (
    <Box>
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

      <Typography sx={{ ...mono, fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.6, mb: 0.75 }}>
        数据备份 · Backup
      </Typography>
      <Typography sx={{ ...mono, fontSize: 10.5, lineHeight: 1.9, opacity: 0.65, mb: 1.5 }}>
        学习记录只保存在本机浏览器。定期导出 JSON 备份，换机或清缓存时可恢复；格式与在线版互通。
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Box
          component="button"
          type="button"
          onClick={handleExport}
          disabled={busy}
          sx={{
            border: '1px solid',
            borderColor: 'text.primary',
            bgcolor: 'text.primary',
            color: 'background.default',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.5 : 1,
            ...btnSx,
          }}
        >
          导出备份
        </Box>
        <Box
          component="button"
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          sx={{
            border: '1px solid',
            borderColor: 'text.primary',
            bgcolor: 'transparent',
            color: 'inherit',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.5 : 1,
            '&:hover': busy ? {} : { bgcolor: 'text.primary', color: 'background.default' },
            ...btnSx,
          }}
        >
          导入备份
        </Box>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          hidden
          aria-label="选择备份文件"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImport(f);
            e.target.value = '';
          }}
        />
      </Box>
    </Box>
  );
};

export default SettingsBackupCard;
