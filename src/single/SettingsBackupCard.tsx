import React, { useRef, useState } from 'react';
import { Box, Typography, Button, Card, CardContent, Alert } from '@mui/material';
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

  return (
    <>
      {msg && (
        <Alert severity={msg.sev} onClose={() => setMsg(null)} sx={{ mb: 1.5 }}>
          {msg.text}
        </Alert>
      )}
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
    </>
  );
};

export default SettingsBackupCard;
